import {
  CATALOG, CATALOG_BY_SKU, HELMET_TICKS, TICK_MS, createInitialState, encodeSnapshot, stageDefFor, step,
  type BoostEffect, type Command, type Difficulty, type GameMode, type GameState, type Input, type PlayerInit, type Snapshot, type TickEvent,
} from '@tank/shared';
import { Emitter, type GameTransport, type MetaEvent } from './transport.js';

export interface LocalHostOptions {
  seed: number;
  stage: number;
  players: PlayerInit[];
  mode?: GameMode;
  difficulty?: Difficulty;
  /** Effects the server pre-authorised for this solo match (from /api/solo/start). Offline: none. */
  boosts?: BoostEffect[];
}

const AT_START: ReadonlySet<BoostEffect> = new Set(['life', 'shield', 'star']);
const MAX_RECORDED_TICKS = 30 * 60 * 60;

function commandFor(effect: BoostEffect, slot: number): Command {
  switch (effect) {
    case 'shield':
      return { type: 'shield', slot, ticks: HELMET_TICKS };
    default:
      return { type: effect, slot };
  }
}

/**
 * Runs the shared deterministic simulation in the browser at a fixed 30 Hz accumulator.
 * Records inputs/commands so the server can verify the replay (`/api/solo/result`).
 */
export class LocalGameHost implements GameTransport {
  readonly mode = 'local' as const;
  readonly mySlot = 0;
  readonly rtt = 0;
  readonly state: GameState;
  readonly inputs: Array<Array<[number, number]>> = [];
  readonly commands: Array<[number, BoostEffect]> = [];
  paused = false;

  private input: Input = { dir: -1, fire: false };
  private pending: Command[] = [];
  private available = new Map<BoostEffect, number>();
  private snapshots = new Emitter<Snapshot>();
  private events = new Emitter<{ events: TickEvent[]; tick: number }>();
  private meta = new Emitter<MetaEvent>();
  private timer = 0;
  private last = 0;
  private acc = 0;
  private stopped = false;
  private stageName: string;

  constructor(opts: LocalHostOptions) {
    this.state = createInitialState(opts.seed, opts.stage, opts.players, opts.mode ?? 'coop', opts.difficulty ?? 'normal');
    this.stageName = stageDefFor(this.state, this.state.stage).name;
    for (const b of opts.boosts ?? []) {
      if (AT_START.has(b)) {
        this.pending.push(commandFor(b, 0));
        this.commands.push([1, b]);
      } else this.available.set(b, (this.available.get(b) ?? 0) + 1);
    }
    this.onVisibility = this.onVisibility.bind(this);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  start(): void {
    if (this.timer) return;
    this.last = performance.now();
    this.acc = 0;
    // Driven by rAF rather than a timer so ticks — and the snapshots the renderer interpolates
    // between — line up with display frames instead of drifting against them.
    const frame = (): void => {
      if (this.stopped) return;
      this.loop();
      this.timer = requestAnimationFrame(frame);
    };
    this.timer = requestAnimationFrame(frame);
    // initial snapshot so the view has something to draw before the first tick
    this.emitSnapshot();
  }

  private onVisibility(): void {
    if (document.hidden) {
      this.acc = 0;
    }
    this.last = performance.now();
  }

  private loop(): void {
    if (this.stopped) return;
    const now = performance.now();
    let dt = now - this.last;
    this.last = now;
    if (this.paused || document.hidden) return;
    if (dt > 250) dt = 250; // never try to catch up more than a few ticks
    this.acc += dt;
    let steps = 0;
    while (this.acc >= TICK_MS && steps < 5) {
      this.acc -= TICK_MS;
      this.tick();
      steps++;
    }
  }

  private tick(): void {
    const s = this.state;
    if (s.status === 'gameOver' && this.pending.length === 0) return; // frozen until revive/stop
    const cmds = this.pending;
    this.pending = [];
    const input = s.status === 'playing' ? this.input : { dir: -1 as const, fire: false };
    if (this.inputs.length < MAX_RECORDED_TICKS) this.inputs.push([[input.dir, input.fire ? 1 : 0]]);
    const prevStage = s.stage;
    step(s, [input], cmds);
    if (s.stage !== prevStage) this.stageName = stageDefFor(s, s.stage).name;
    this.emitSnapshot();
    s.tileChanges = [];
  }

  private emitSnapshot(): void {
    const snap = encodeSnapshot(this.state, true, this.stageName);
    this.snapshots.emit(snap);
    if (snap.events.length) this.events.emit({ events: snap.events, tick: snap.t });
  }

  sendInput(input: Input): void {
    this.input = input;
  }

  useItem(sku: string): void {
    const item = CATALOG_BY_SKU[sku];
    const effect = item?.effect;
    if (!effect || AT_START.has(effect)) return;
    const left = this.available.get(effect) ?? 0;
    if (left <= 0) {
      this.meta.emit({ type: 'itemResult', sku, ok: false, error: 'none_left' });
      return;
    }
    const p = this.state.players[0];
    if (effect === 'revive' && (!p || p.lives > 0)) {
      this.meta.emit({ type: 'itemResult', sku, ok: false, error: 'not_dead' });
      return;
    }
    if (this.commands.length >= 20) {
      this.meta.emit({ type: 'itemResult', sku, ok: false, error: 'limit' });
      return;
    }
    this.available.set(effect, left - 1);
    this.pending.push(commandFor(effect, 0));
    this.commands.push([this.state.tick + 1, effect]);
    this.meta.emit({ type: 'itemResult', sku, ok: true, inventory: this.itemCounts() });
  }

  itemCounts(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const item of CATALOG) {
      if (item.effect && !item.atStart) out[item.sku] = this.available.get(item.effect) ?? 0;
    }
    return out;
  }

  onSnapshot(cb: (snap: Snapshot) => void): () => void {
    return this.snapshots.on(cb);
  }
  onEvent(cb: (events: TickEvent[], tick: number) => void): () => void {
    return this.events.on((e) => cb(e.events, e.tick));
  }
  onMeta(cb: (ev: MetaEvent) => void): () => void {
    return this.meta.on(cb);
  }

  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.meta.emit({ type: 'paused', paused: true });
  }
  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.last = performance.now();
    this.acc = 0;
    this.meta.emit({ type: 'paused', paused: false });
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) cancelAnimationFrame(this.timer);
    this.timer = 0;
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.snapshots.clear();
    this.events.clear();
    this.meta.clear();
  }
}
