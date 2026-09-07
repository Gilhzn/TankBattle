import { DAILY_REWARDS, REWARD_RULES } from '@tank/shared';
import type { Db, DailyRow } from '../db/repo.js';
import { conflict, notFound } from '../util/errors.js';
import { newNonce } from '../util/ids.js';
import { dayStart, utcDay, type Clock } from '../util/time.js';
import { applyGrants, type Grants } from './grants.js';
import type { InventoryDTO, InventoryService } from './inventory.js';
import type { WalletDTO, WalletService } from './wallet.js';

export interface DailyDTO {
  streak: number;
  /** 1..7: the NEXT reward index. */
  day: number;
  claimable: boolean;
  nextClaimAt: number;
  rewards: typeof DAILY_REWARDS;
}

/** Daily login streak and rewarded ads. */
export class RewardsService {
  constructor(
    private readonly db: Db,
    private readonly wallet: WalletService,
    private readonly inventory: InventoryService,
    private readonly clock: Clock,
  ) {}

  private dailyRow(userId: string): DailyRow {
    return this.db.daily.get(userId) ?? { userId, streak: 0, lastClaimDay: null, lastClaimAt: null };
  }

  /** Streak continues when the previous claim was yesterday (UTC); resets otherwise. */
  private nextStreak(r: DailyRow, today: number): number {
    return r.lastClaimDay === today - 1 ? r.streak + 1 : 1;
  }

  daily(userId: string): DailyDTO {
    const now = this.clock();
    const today = utcDay(now);
    const r = this.dailyRow(userId);
    const claimable = r.lastClaimDay !== today;
    const upcoming = claimable ? this.nextStreak(r, today) : r.streak + 1;
    return {
      streak: r.streak,
      day: ((upcoming - 1) % DAILY_REWARDS.length) + 1,
      claimable,
      nextClaimAt: claimable ? now : dayStart(today + 1),
      rewards: DAILY_REWARDS,
    };
  }

  claimDaily(userId: string): { reward: Grants; wallet: WalletDTO; inventory: InventoryDTO; daily: DailyDTO } {
    const now = this.clock();
    const today = utcDay(now);
    return this.db.transaction(() => {
      const r = this.dailyRow(userId);
      if (r.lastClaimDay === today) throw conflict('already claimed today', 'already_claimed');
      const streak = this.nextStreak(r, today);
      const reward = DAILY_REWARDS[(streak - 1) % DAILY_REWARDS.length];
      applyGrants(this.wallet, this.inventory, userId, reward, 'daily', `day${today}`);
      this.db.daily.put({ userId, streak, lastClaimDay: today, lastClaimAt: now });
      return { reward, wallet: this.wallet.get(userId), inventory: this.inventory.list(userId), daily: this.daily(userId) };
    });
  }

  adStart(userId: string, placement: 'results' | 'menu'): { adSessionId: string; minSeconds: number; remainingToday: number } {
    const now = this.clock();
    const day = utcDay(now);
    return this.db.transaction(() => {
      const used = this.db.ads.countForDay(userId, day);
      if (used >= REWARD_RULES.adMaxPerDay) throw conflict('daily ad limit reached', 'ad_limit');
      const id = newNonce(16);
      this.db.ads.insert({ id, userId, placement, day, startedAt: now, completedAt: null, matchResultId: null, coins: 0 });
      return { adSessionId: id, minSeconds: REWARD_RULES.adMinSeconds, remainingToday: REWARD_RULES.adMaxPerDay - used - 1 };
    });
  }

  /** 'menu' pays a flat amount; 'results' doubles the coins of the latest match (once per match). */
  adComplete(userId: string, adSessionId: string, placement: 'results' | 'menu'): { coins: number; wallet: WalletDTO } {
    const now = this.clock();
    return this.db.transaction(() => {
      const s = this.db.ads.get(adSessionId);
      if (!s || s.userId !== userId) throw notFound('ad session not found', 'ad_not_found');
      if (s.completedAt !== null) throw conflict('ad already claimed', 'already_claimed');
      if (now - s.startedAt < REWARD_RULES.adMinSeconds * 1000) throw conflict('ad watched too fast', 'too_fast');
      let coins: number = REWARD_RULES.adMenuCoins;
      let matchResultId: string | null = null;
      if (placement === 'results') {
        const m = this.db.matches.latest(userId);
        if (!m) throw conflict('no match to double', 'no_match');
        if (this.db.ads.hasCompletedForMatch(userId, m.id)) throw conflict('match already doubled', 'already_doubled');
        coins = m.coins;
        matchResultId = m.id;
      }
      this.db.ads.update(s.id, { completedAt: now, matchResultId, coins, placement });
      const wallet = coins > 0 ? this.wallet.credit(userId, 'coins', coins, 'ad', s.id) : this.wallet.get(userId);
      return { coins, wallet };
    });
  }
}
