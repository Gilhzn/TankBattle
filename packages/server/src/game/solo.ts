import { HELMET_TICKS, REWARD_RULES, simulateReplay, type BoostEffect, type Command, type Input } from '@tank/shared';
import type { Db } from '../db/repo.js';
import type { BattlePassDTO, BattlepassService } from '../economy/battlepass.js';
import { boostOrNull } from '../economy/catalog.js';
import type { InventoryDTO, InventoryService } from '../economy/inventory.js';
import type { WalletDTO, WalletService } from '../economy/wallet.js';
import { badRequest, conflict, notFound } from '../util/errors.js';
import { newId, newSeed } from '../util/ids.js';
import { utcDay, type Clock } from '../util/time.js';
import type { ResultsService } from './results.js';

export const SOLO_SESSION_TTL_MS = 2 * 60 * 60 * 1000;
export const SOLO_MAX_TICKS = 30 * 60 * 60;
const AT_START: ReadonlySet<BoostEffect> = new Set(['life', 'shield', 'star']);

export interface SoloStart {
  soloId: string;
  seed: number;
  stage: number;
  boosts: BoostEffect[];
  inventory: InventoryDTO;
}

export interface SoloResultInput {
  soloId: string;
  inputs: Array<Array<[number, number]>>;
  commands: Array<[number, BoostEffect]>;
  claimedScore: number;
  claimedStage: number;
}

export interface SoloResult {
  verified: boolean;
  score: number;
  stage: number;
  coins: number;
  xp: number;
  wallet: WalletDTO;
  battlepass: BattlePassDTO;
}

/** Builds the sim command for an authorised boost effect on slot 0. */
export function commandFor(effect: BoostEffect, slot: number): Command {
  return effect === 'shield' ? { type: 'shield', slot, ticks: HELMET_TICKS } : { type: effect, slot };
}

/** Offline solo play: the server issues the seed + authorised boosts, then re-simulates the submitted inputs. */
export class SoloService {
  constructor(
    private readonly db: Db,
    private readonly wallet: WalletService,
    private readonly inventory: InventoryService,
    private readonly battlepass: BattlepassService,
    private readonly results: ResultsService,
    private readonly clock: Clock,
  ) {}

  start(userId: string, loadout: string[], stage: number): SoloStart {
    const now = this.clock();
    return this.db.transaction(() => {
      const boosts: BoostEffect[] = [];
      for (const sku of new Set(loadout)) {
        const item = boostOrNull(sku);
        if (!item) continue;
        if (boosts.includes(item.effect)) continue;
        if (this.inventory.consume(userId, sku, 1)) boosts.push(item.effect);
      }
      const id = newId();
      const seed = newSeed();
      this.db.solo.insert({ id, userId, seed, stage, boosts, createdAt: now, consumedAt: null });
      return { soloId: id, seed, stage, boosts, inventory: this.inventory.list(userId) };
    });
  }

  result(userId: string, body: SoloResultInput): SoloResult {
    const now = this.clock();
    const s = this.db.solo.get(body.soloId);
    if (!s || s.userId !== userId) throw notFound('solo session not found', 'solo_not_found');
    if (s.consumedAt !== null) throw conflict('solo session already submitted', 'already_submitted');
    if (now - s.createdAt > SOLO_SESSION_TTL_MS) throw conflict('solo session expired', 'solo_expired');
    if (body.inputs.length > SOLO_MAX_TICKS) throw badRequest('too many ticks', 'too_long');

    // Only pre-authorised effects, each at most once, at-start ones on tick 1.
    const remaining = [...s.boosts];
    const commands: Array<{ tick: number; command: Command }> = [];
    for (const [tick, effect] of body.commands) {
      const idx = remaining.indexOf(effect);
      if (idx < 0) throw badRequest(`boost ${effect} was not authorised for this session`, 'unauthorised_boost');
      if (AT_START.has(effect) && tick !== 1) throw badRequest(`${effect} must be applied on tick 1`, 'bad_boost_tick');
      if (tick > body.inputs.length + 1) throw badRequest('boost tick beyond replay', 'bad_boost_tick');
      remaining.splice(idx, 1);
      commands.push({ tick, command: commandFor(effect, 0) });
    }

    const inputs = body.inputs.map((frame): [number, number][] => [normalizeFrame(frame[0])]);
    const state = simulateReplay({ seed: s.seed, stage: s.stage, players: 1, inputs, commands });
    const p = state.players[0];
    const score = p?.score ?? 0;
    const kills = p?.kills ?? 0;
    const stageReached = state.stage;
    const verified = body.claimedScore === score && body.claimedStage === stageReached;

    const day = utcDay(now);
    const outcome = this.db.transaction(() => {
      const claimed = this.db.soloClaims.get(userId, day)?.coins ?? 0;
      const cap = Math.max(0, REWARD_RULES.soloDailyCoinCap - claimed);
      const r = this.results.record(userId, 'solo', { score, kills, stageReached, stagesCleared: stageReached - s.stage }, cap);
      this.db.soloClaims.put({ userId, day, coins: claimed + r.coins });
      this.db.solo.update(s.id, { consumedAt: now });
      return r;
    });
    return { verified, score, stage: stageReached, coins: outcome.coins, xp: outcome.xp, wallet: this.wallet.get(userId), battlepass: this.battlepass.get(userId) };
  }
}

function normalizeFrame(pair: [number, number] | undefined): [number, number] {
  if (!pair) return [-1, 0];
  const dir = pair[0];
  const okDir: Input['dir'] = dir === 0 || dir === 1 || dir === 2 || dir === 3 ? dir : -1;
  return [okDir, pair[1] === 1 ? 1 : 0];
}
