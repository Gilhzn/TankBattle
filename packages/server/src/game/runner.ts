import {
  createInitialState, encodeSnapshot, matchRewards, stageDefFor, step, versusWinningTeams,
  type Command, type GameState, type Input, type MatchResult, type ServerMessage, type TickEvent,
} from '@tank/shared';
import { boostOrNull } from '../economy/catalog.js';
import type { InventoryService } from '../economy/inventory.js';
import type { WalletService } from '../economy/wallet.js';
import type { Room, RoomPlayer } from '../rooms/room.js';
import { newSeed } from '../util/ids.js';
import type { Logger } from '../util/log.js';
import type { ResultsService } from './results.js';
import { commandFor } from './solo.js';

export interface RunnerDeps {
  inventory: InventoryService;
  wallet: WalletService;
  results: ResultsService;
  log: Logger;
  tickRate: number;
  snapshotEvery: number;
  fullSnapshotEvery: number;
  /** Ticks a dead party gets to use a revive token before the match is finalised. */
  reviveGraceTicks?: number;
}

const MAX_CATCHUP_TICKS = 5;

/** Runs one authoritative simulation for a room at `tickRate` Hz and streams snapshots. */
export class GameRunner {
  readonly state: GameState;
  readonly seed: number;
  readonly startStage = 1;
  private inputs: Array<Input | null> = [];
  private lastSeq: number[] = [];
  private pending: Command[] = [];
  private pendingEvents: TickEvent[] = [];
  private timer: NodeJS.Timeout | null = null;
  private acc = 0;
  private last = 0;
  private forceFull = false;
  private finished = false;
  private graceUntil: number | null = null;
  private readonly tickMs: number;

  constructor(
    private readonly room: Room,
    private readonly deps: RunnerDeps,
  ) {
    this.seed = newSeed();
    this.tickMs = 1000 / deps.tickRate;
    const players = [...room.players].sort((a, b) => a.slot - b.slot).map((p) => ({ id: p.id, name: p.name, skin: p.skin }));
    this.state = createInitialState(this.seed, this.startStage, players, room.mode, room.difficulty, room.versusFormat);
  }

  get tick(): number {
    return this.state.tick;
  }

  private get stageName(): string {
    return stageDefFor(this.state, this.state.stage).name;
  }

  /** Applies at-start loadout boosts, sends `gameStart` to everyone and starts the loop. */
  start(): void {
    if (this.room.mode === 'coop') {
      for (const p of this.room.players) {
        for (const sku of new Set(p.loadout)) {
          const item = boostOrNull(sku);
          if (!item?.atStart) continue;
          if (!this.deps.inventory.consume(p.id, sku, 1)) continue;
          this.pending.push(commandFor(item.effect, p.slot));
          this.bumpUsed(p.slot, sku);
        }
      }
    }
    const snapshot = encodeSnapshot(this.state, true, this.stageName);
    this.state.tileChanges = [];
    for (const p of this.room.players) p.link?.send({ type: 'gameStart', seed: this.seed, stage: this.state.stage, snapshot, yourSlot: p.slot });
    this.last = performance.now();
    this.timer = setInterval(() => this.pump(), Math.max(1, Math.floor(this.tickMs)));
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.finished = true;
  }

  /** Latest input wins; stale/duplicate sequence numbers are ignored. */
  onInput(slot: number, seq: number, dir: Input['dir'], fire: boolean): void {
    if (seq <= (this.lastSeq[slot] ?? -1)) return;
    this.lastSeq[slot] = seq;
    this.inputs[slot] = { dir, fire };
  }

  /** Advances the simulation synchronously (deterministic tests, not used by the live loop). */
  stepTicks(n: number): void {
    for (let i = 0; i < n && !this.finished; i++) this.stepOnce();
  }

  clearInput(slot: number): void {
    this.inputs[slot] = null;
  }

  removePlayer(slot: number): void {
    this.inputs[slot] = null;
    this.pending.push({ type: 'removePlayer', slot });
  }

  /** Full snapshot for a (re)joining player. */
  sendFull(p: RoomPlayer): void {
    p.link?.send({ type: 'snapshot', snapshot: encodeSnapshot(this.state, true, this.stageName) });
  }

  /** Validates and consumes an on-demand boost; returns the `itemResult` reply. */
  useItem(p: RoomPlayer, sku: string, nonce: string): ServerMessage {
    const fail = (error: string): ServerMessage => ({ type: 'itemResult', nonce, ok: false, error });
    if (this.finished || this.room.status !== 'playing') return fail('not_playing');
    const item = boostOrNull(sku);
    if (!item) return fail('unknown_item');
    if (this.room.mode === 'versus') return fail('versus');
    const ps = this.state.players[p.slot];
    if (!ps || !ps.active) return fail('not_in_game');
    if (item.effect === 'revive' && ps.lives > 0) return fail('not_dead');
    if (item.effect === 'revive' && this.state.status === 'gameOver' && this.state.gameOverReason !== 'lives') return fail('not_playing');
    const used = ps.usedItems[sku] ?? 0;
    if (used >= (item.maxPerMatch ?? 1)) return fail('max_per_match');
    if (!this.deps.inventory.consume(p.id, sku, 1)) return fail('not_owned');
    this.bumpUsed(p.slot, sku);
    this.pending.push(commandFor(item.effect, p.slot));
    return { type: 'itemResult', nonce, ok: true, inventory: this.deps.inventory.counts(p.id) };
  }

  private bumpUsed(slot: number, sku: string): void {
    const ps = this.state.players[slot];
    if (ps) ps.usedItems[sku] = (ps.usedItems[sku] ?? 0) + 1;
  }

  /** Drift-corrected loop: runs as many ticks as wall time owes, capped per pump. */
  private pump(): void {
    if (this.finished) return;
    const now = performance.now();
    this.acc += now - this.last;
    this.last = now;
    let n = 0;
    while (this.acc >= this.tickMs && n < MAX_CATCHUP_TICKS && !this.finished) {
      this.acc -= this.tickMs;
      this.stepOnce();
      n++;
    }
    if (this.acc > this.tickMs * MAX_CATCHUP_TICKS) this.acc = 0;
  }

  private stepOnce(): void {
    const commands = this.pending;
    this.pending = [];
    const inputs = this.state.players.map((_, i) => this.inputs[i] ?? null);
    const wasOver = this.state.status === 'gameOver';
    try {
      step(this.state, inputs, commands);
    } catch (err) {
      this.deps.log.error(`room ${this.room.code}: simulation error`, err);
      this.finish('error');
      return;
    }
    this.pendingEvents.push(...this.state.events);
    for (const ev of this.state.events) if (ev.type === 'stageClear') this.sendStageClear(ev.stage);
    const justOver = !wasOver && this.state.status === 'gameOver';
    if (this.state.tick % this.deps.snapshotEvery === 0 || this.forceFull || justOver) this.sendSnapshot();
    if (justOver) {
      const canRevive = this.state.mode === 'coop' && this.state.gameOverReason === 'lives' && this.anyoneCanRevive();
      if (canRevive) this.graceUntil = this.state.tick + (this.deps.reviveGraceTicks ?? 5 * this.deps.tickRate);
      else this.finish(this.state.gameOverReason ?? 'unknown');
    } else if (this.graceUntil !== null) {
      if (this.state.status === 'playing') this.graceUntil = null;
      else if (this.state.tick >= this.graceUntil) this.finish(this.state.gameOverReason ?? 'lives');
    }
  }

  private anyoneCanRevive(): boolean {
    return this.room.players.some((p) => {
      const ps = this.state.players[p.slot];
      return ps?.active && (ps.usedItems.revive_token ?? 0) < 1 && this.deps.inventory.qty(p.id, 'revive_token') > 0;
    });
  }

  private sendSnapshot(): void {
    const full = this.forceFull || this.state.tick % this.deps.fullSnapshotEvery === 0;
    this.forceFull = false;
    const snapshot = encodeSnapshot(this.state, full, this.stageName);
    snapshot.events = this.pendingEvents;
    this.pendingEvents = [];
    this.state.tileChanges = [];
    this.room.broadcast({ type: 'snapshot', snapshot });
  }

  private sendStageClear(stage: number): void {
    const coop = this.state.mode === 'coop';
    const scores = this.state.players.filter((p) => p.active).map((p) => ({ playerId: p.id, score: p.score }));
    for (const p of this.room.players) {
      const ps = this.state.players[p.slot];
      const coinsEarned = ps ? matchRewards(ps.score, stage - this.startStage + 1, ps.kills, coop).coins : 0;
      p.link?.send({ type: 'stageClear', stage, scores, coinsEarned });
    }
  }

  /** Finalises the match: rewards, `gameOver`, `walletUpdate`, then hands the room back to the lobby. */
  private finish(reason: string): void {
    if (this.finished) return;
    this.stop();
    const st = this.state;
    const coop = st.mode === 'coop';
    const stagesCleared = Math.max(0, st.stage - this.startStage);
    // Versus is won by the last side standing, not by score: a player who survives on one life
    // beats one who racked up points and then ran out of lives.
    const winners = coop ? [] : versusWinningTeams(st);
    const results: MatchResult[] = [];
    for (const p of this.room.players) {
      const ps = st.players[p.slot];
      if (!ps || !ps.active || ps.id !== p.id) continue;
      let coins = 0;
      let xp = 0;
      try {
        const r = this.deps.results.record(p.id, st.mode, { score: ps.score, kills: ps.kills, stageReached: st.stage, stagesCleared });
        coins = r.coins;
        xp = r.xp;
      } catch (err) {
        this.deps.log.error(`room ${this.room.code}: failed to record result for ${p.id}`, err);
      }
      results.push({
        playerId: p.id, name: p.name, slot: p.slot, score: ps.score, kills: ps.kills, deaths: ps.deaths,
        team: ps.team, stageReached: st.stage, coins, xp,
        won: coop ? stagesCleared > 0 : winners.includes(ps.team),
      });
    }
    this.room.broadcast({ type: 'gameOver', reason, results });
    for (const p of this.room.players) {
      const w = this.deps.wallet.get(p.id);
      p.link?.send({ type: 'walletUpdate', coins: w.coins, gems: w.gems });
    }
    this.room.onGameOver();
  }
}
