import { matchRewards } from '@tank/shared';
import type { Db, MatchMode } from '../db/repo.js';
import type { BattlepassService } from '../economy/battlepass.js';
import type { WalletService } from '../economy/wallet.js';
import { newId } from '../util/ids.js';
import type { Clock } from '../util/time.js';

export interface MatchOutcome {
  score: number;
  stagesCleared: number;
  stageReached: number;
  kills: number;
}

/** Credits coins + battle-pass xp for a finished match and records the result row. */
export class ResultsService {
  constructor(
    private readonly db: Db,
    private readonly wallet: WalletService,
    private readonly battlepass: BattlepassService,
    private readonly clock: Clock,
  ) {}

  record(userId: string, mode: MatchMode, o: MatchOutcome, coinsCap?: number): { id: string; coins: number; xp: number } {
    const reward = matchRewards(o.score, Math.max(0, o.stagesCleared), o.kills, mode === 'coop');
    const coins = coinsCap === undefined ? reward.coins : Math.max(0, Math.min(reward.coins, coinsCap));
    const id = newId();
    this.db.transaction(() => {
      if (coins > 0) this.wallet.credit(userId, 'coins', coins, 'match', id);
      this.battlepass.addXp(userId, reward.xp);
      this.db.matches.insert({ id, userId, mode, score: o.score, stage: o.stageReached, kills: o.kills, coins, xp: reward.xp, createdAt: this.clock() });
    });
    return { id, coins, xp: reward.xp };
  }
}
