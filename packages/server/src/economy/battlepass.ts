import { BATTLEPASS_SEASON_DAYS, BATTLEPASS_TIERS, CATALOG_BY_SKU, type BattlePassTier } from '@tank/shared';
import type { BattlepassRow, Db } from '../db/repo.js';
import { badRequest, conflict } from '../util/errors.js';
import { DAY_MS, type Clock } from '../util/time.js';
import { applyGrants } from './grants.js';
import type { InventoryService } from './inventory.js';
import type { WalletService } from './wallet.js';

export interface BattlePassDTO {
  season: number;
  endsAt: number;
  xp: number;
  tier: number;
  premium: boolean;
  claimedFree: number[];
  claimedPremium: number[];
  tiers: BattlePassTier[];
}

export const SEASON_EPOCH = Date.UTC(2026, 0, 1);
const SEASON_MS = BATTLEPASS_SEASON_DAYS * DAY_MS;

export function seasonAt(now: number): { season: number; endsAt: number } {
  const season = Math.max(0, Math.floor((now - SEASON_EPOCH) / SEASON_MS));
  return { season, endsAt: SEASON_EPOCH + (season + 1) * SEASON_MS };
}

/** Highest tier whose xp threshold is reached. */
export function tierForXp(xp: number): number {
  let tier = 0;
  for (const t of BATTLEPASS_TIERS) if (t.xp <= xp) tier = t.tier;
  return tier;
}

export class BattlepassService {
  constructor(
    private readonly db: Db,
    private readonly wallet: WalletService,
    private readonly inventory: InventoryService,
    private readonly clock: Clock,
  ) {}

  private row(userId: string): BattlepassRow {
    const { season } = seasonAt(this.clock());
    return this.db.battlepass.get(userId, season) ?? { userId, season, xp: 0, premium: false, claimedFree: [], claimedPremium: [] };
  }

  get(userId: string): BattlePassDTO {
    const { season, endsAt } = seasonAt(this.clock());
    const r = this.row(userId);
    return { season, endsAt, xp: r.xp, tier: tierForXp(r.xp), premium: r.premium, claimedFree: [...r.claimedFree], claimedPremium: [...r.claimedPremium], tiers: BATTLEPASS_TIERS };
  }

  addXp(userId: string, xp: number): BattlePassDTO {
    const n = Math.max(0, Math.floor(xp));
    if (n > 0) {
      this.db.transaction(() => {
        const r = this.row(userId);
        this.db.battlepass.put({ ...r, xp: r.xp + n });
      });
    }
    return this.get(userId);
  }

  hasPremium(userId: string): boolean {
    return this.row(userId).premium;
  }

  claim(userId: string, tier: number, track: 'free' | 'premium'): BattlePassDTO {
    const def = BATTLEPASS_TIERS.find((t) => t.tier === tier);
    if (!def) throw badRequest('unknown tier', 'bad_tier');
    return this.db.transaction(() => {
      const r = this.row(userId);
      if (tierForXp(r.xp) < tier) throw conflict('tier not reached', 'tier_locked');
      if (track === 'premium' && !r.premium) throw conflict('premium pass required', 'premium_required');
      const claimed = track === 'free' ? r.claimedFree : r.claimedPremium;
      if (claimed.includes(tier)) throw conflict('already claimed', 'already_claimed');
      const grants = track === 'free' ? def.free : def.premium;
      if (!grants) throw conflict('nothing to claim on this track', 'empty_tier');
      applyGrants(this.wallet, this.inventory, userId, grants, 'battlepass', `${r.season}:${track}:${tier}`);
      claimed.push(tier);
      this.db.battlepass.put(r);
      return this.get(userId);
    });
  }

  /** Buys the premium track for the current season with gems. */
  buyPremium(userId: string): BattlePassDTO {
    const price = CATALOG_BY_SKU.battlepass_premium?.prices.gems ?? 950;
    return this.db.transaction(() => {
      const r = this.row(userId);
      if (r.premium) throw conflict('premium already active', 'already_owned');
      this.wallet.debit(userId, 'gems', price, 'purchase', 'battlepass_premium');
      this.db.battlepass.put({ ...r, premium: true });
      return this.get(userId);
    });
  }
}
