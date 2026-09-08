import { TICK_MS, TILE, type BulletDTO, type Snapshot, type TankDTO } from '@tank/shared';

export interface Pos {
  x: number;
  y: number;
}

interface Frame {
  t: number;
  tanks: Map<number, Pos>;
  bullets: Map<number, Pos>;
}

/** Distance above which tank positions are snapped instead of interpolated (a respawn/teleport). */
export const SNAP_DISTANCE = TILE;
/** Bullets never teleport (a new bullet gets a new id) but cover up to 2 tiles between snapshots. */
export const BULLET_SNAP_DISTANCE = TILE * 8;

// ---------------------------------------------------------------------------
// Playout tuning. The render clock is a local clock locked to the server tick
// rate; these constants say how hard it is allowed to pull on that lock.
// ---------------------------------------------------------------------------

/** How much of each snapshot's timing error is folded into the clock offset (per snapshot). */
const OFFSET_EASE = 0.08;
/** A snapshot this far off the estimated clock is a stall/reconnect, not jitter: resync instead of easing. */
const OFFSET_RESYNC_MS = 400;
/** Per-snapshot decay of the observed jitter peak (~1.5 s half-life at 15 Hz). */
const JITTER_DECAY = 0.96;
/** Safety factor on the measured jitter when sizing the buffer. */
const JITTER_MARGIN = 1.2;
/** Ticks of buffer the adaptive margin may add on top of `delayTicks`. */
const MAX_EXTRA_DELAY = 5;
/** The delay grows quickly (protect smoothness) and shrinks slowly (protect against flapping). */
const DELAY_GROW = 0.35;
const DELAY_SHRINK = 0.02;
/** Playout rate correction per tick of error, and the cap on how far the rate may deviate from 1. */
const RATE_GAIN = 0.12;
const MAX_RATE_DEV = 0.12;
/** Divergence (ticks) beyond which the playout head is teleported rather than eased. */
const RESYNC_TICKS = 8;
/** How far past the newest snapshot the playout head may run before it is held. */
const MAX_EXTRAP_TICKS = 2;
/** Hard cap (sub-units, a quarter tile) on how far dead reckoning may move an entity per axis. */
const EXTRAP_MAX_DIST = TILE / 4;
/** Frame delta cap, so a throttled/backgrounded rAF cannot fast-forward the playout head. */
const MAX_FRAME_MS = 250;
/** A snapshot older than the buffer by more than this is a new match (rewind), not a reordered packet. */
const REWIND_TICKS = 4;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/**
 * Keeps the last N snapshots and produces smoothly interpolated entity positions
 * `delayTicks` behind the *estimated* server tick (0 for the local host = render the latest exactly).
 *
 * The playout head is driven by a local clock locked to the server's tick rate rather than by the
 * arrival time of the newest snapshot: arrival jitter is absorbed by easing the clock offset and by
 * sizing the buffer, instead of being copied straight into the motion of every entity.
 */
export class InterpBuffer {
  private frames: Frame[] = [];
  /** Estimated local time (ms) at which server tick 0 would have arrived; `tick(now) = (now - offset)/TICK_MS`. */
  private offsetMs = 0;
  private hasClock = false;
  /** Decaying peak of the snapshot timing error (ms) — how unsteady the stream currently is. */
  private jitterMs = 0;
  /** Effective playout delay in ticks: `delayTicks` plus the eased adaptive margin. */
  private delay: number;
  /** Monotone playout head, in server ticks. */
  private rt = 0;
  private hasRt = false;
  private lastNow = 0;

  constructor(
    public delayTicks = 3,
    public size = 12,
    /** Extra ticks of buffer the adaptive margin may add; 0 pins the delay (local host). */
    public maxExtraDelay = delayTicks >= 2 ? MAX_EXTRA_DELAY : 0,
  ) {
    this.delay = delayTicks;
  }

  clear(): void {
    this.frames = [];
    this.hasClock = false;
    this.hasRt = false;
    this.jitterMs = 0;
    this.delay = this.delayTicks;
  }

  /** Diagnostics for tests and the debug HUD. */
  get stats(): { delay: number; jitterMs: number; renderTick: number; latestTick: number; frames: number } {
    return { delay: this.delay, jitterMs: this.jitterMs, renderTick: this.rt, latestTick: this.latestTick, frames: this.frames.length };
  }

  /** Current playout delay in ticks (base + adaptive margin). */
  get effectiveDelay(): number {
    return this.delay;
  }

  push(snap: Snapshot, nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now()): void {
    const t = snap.t;
    if (this.frames.length) {
      const oldest = this.frames[0].t;
      // A big step backwards is a new match / stage rewind; a small one is a reordered or
      // duplicated packet for a tick we have already dropped, which is simply stale.
      if (t < oldest - REWIND_TICKS) this.clear();
      else if (t < oldest) return;
    }
    const tanks = new Map<number, Pos>();
    for (const tk of snap.tanks as TankDTO[]) tanks.set(tk[0], { x: tk[3], y: tk[4] });
    const bullets = new Map<number, Pos>();
    for (const b of snap.bullets as BulletDTO[]) bullets.set(b[0], { x: b[1], y: b[2] });
    const frame: Frame = { t, tanks, bullets };

    // Insert in tick order so an out-of-order arrival repairs the buffer instead of resetting it.
    let i = this.frames.length;
    while (i > 0 && this.frames[i - 1].t > t) i--;
    const duplicate = i > 0 && this.frames[i - 1].t === t;
    if (duplicate) this.frames[i - 1] = frame;
    else this.frames.splice(i, 0, frame);
    while (this.frames.length > this.size) this.frames.shift();

    // Only a snapshot that extends the head of the stream says anything about where the
    // server's "now" is; duplicates and late stragglers would drag the clock backwards.
    if (!duplicate && this.frames[this.frames.length - 1] === frame) this.trackClock(t, nowMs);
  }

  /** Folds one arrival into the server-time estimate, the jitter estimate and the playout delay. */
  private trackClock(t: number, nowMs: number): void {
    const sample = nowMs - t * TICK_MS;
    if (!this.hasClock) {
      this.offsetMs = sample;
      this.hasClock = true;
      this.jitterMs = 0;
      this.delay = this.delayTicks;
      return;
    }
    const err = sample - this.offsetMs;
    if (Math.abs(err) > OFFSET_RESYNC_MS) {
      // A pause, a reconnect or a hidden tab — the old offset is meaningless, start over.
      this.offsetMs = sample;
      this.jitterMs = 0;
      this.delay = this.delayTicks;
      return;
    }
    // Peak-hold with decay: one late packet widens the buffer immediately, a steady stream narrows
    // it back over a couple of seconds. An EMA would react far too slowly to a single 150 ms gap.
    this.jitterMs = Math.max(Math.abs(err), this.jitterMs * JITTER_DECAY);
    this.offsetMs += err * OFFSET_EASE;
    const target = this.delayTicks + Math.min(this.maxExtraDelay, (this.jitterMs * JITTER_MARGIN) / TICK_MS);
    this.delay += (target - this.delay) * (target > this.delay ? DELAY_GROW : DELAY_SHRINK);
  }

  get latestTick(): number {
    return this.frames.length ? this.frames[this.frames.length - 1].t : 0;
  }

  /**
   * The tick to render at `nowMs`. It advances with local wall time at (close to) the server tick
   * rate, is nudged — never snapped — toward `serverTick - delay`, and is held at most
   * `MAX_EXTRAP_TICKS` past the newest snapshot when the buffer runs dry.
   */
  renderTick(nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now()): number {
    const frames = this.frames;
    if (!frames.length) return 0;
    const last = frames[frames.length - 1];
    if (this.delayTicks <= 0 || !this.hasClock) return last.t;

    const target = (nowMs - this.offsetMs) / TICK_MS - this.delay;
    if (!this.hasRt || Math.abs(target - this.rt) > RESYNC_TICKS) {
      this.rt = target; // first frame, or a divergence too large to hide (stall, tab restore)
      this.hasRt = true;
    } else {
      // Free-run at the server tick rate, then correct the residual error by dilating time by at
      // most ±MAX_RATE_DEV. The head therefore never stops and never runs backwards.
      const dtTicks = clamp(nowMs - this.lastNow, 0, MAX_FRAME_MS) / TICK_MS;
      const rate = 1 + clamp((target - (this.rt + dtTicks)) * RATE_GAIN, -MAX_RATE_DEV, MAX_RATE_DEV);
      this.rt += dtTicks * rate;
    }
    this.lastNow = nowMs;
    // Tail: hold a little past the newest snapshot (positions hold at their last known value)
    // rather than letting the head run away from the data it would have to be re-synced to.
    const cap = last.t + MAX_EXTRAP_TICKS;
    if (this.rt > cap) this.rt = cap;
    return this.rt;
  }

  /** Indices of the frames bounding `rt` (-1 when there is none on that side). */
  private bounds(rt: number): [number, number] {
    let a = -1;
    let b = -1;
    for (let i = 0; i < this.frames.length; i++) {
      const f = this.frames[i];
      if (f.t <= rt) a = i;
      if (f.t >= rt) {
        b = i;
        break;
      }
    }
    return [a, b];
  }

  private sample(kind: 'tanks' | 'bullets', id: number, rt: number, fallback: Pos): Pos {
    const [ai, bi] = this.bounds(rt);
    const a = ai >= 0 ? this.frames[ai] : null;
    const b = bi >= 0 ? this.frames[bi] : null;
    const pa = a?.[kind].get(id);
    const pb = b?.[kind].get(id);
    const snapAt = kind === 'tanks' ? SNAP_DISTANCE : BULLET_SNAP_DISTANCE;
    if (pa && pb && a && b) {
      if (a === b || b.t === a.t) return pb;
      if (Math.abs(pb.x - pa.x) > snapAt || Math.abs(pb.y - pa.y) > snapAt) return pb;
      const f = (rt - a.t) / (b.t - a.t);
      return { x: pa.x + (pb.x - pa.x) * f, y: pa.y + (pb.y - pa.y) * f };
    }
    // Past the newest snapshot (the buffer ran dry): carry the last known velocity forward for at
    // most MAX_EXTRAP_TICKS and EXTRAP_MAX_DIST, which turns a frozen frame into a short glide.
    if (pa && a && !pb && ai > 0) {
      const prev = this.frames[ai - 1];
      const pp = prev[kind].get(id);
      const span = a.t - prev.t;
      if (pp && span > 0) {
        const vx = (pa.x - pp.x) / span;
        const vy = (pa.y - pp.y) / span;
        if (Math.abs(vx * span) <= snapAt && Math.abs(vy * span) <= snapAt) {
          const dt = Math.min(rt - a.t, MAX_EXTRAP_TICKS);
          const dx = clamp(vx * dt, -EXTRAP_MAX_DIST, EXTRAP_MAX_DIST);
          const dy = clamp(vy * dt, -EXTRAP_MAX_DIST, EXTRAP_MAX_DIST);
          return { x: pa.x + dx, y: pa.y + dy };
        }
      }
    }
    return pb ?? pa ?? fallback;
  }

  tankPos(id: number, rt: number, fallback: Pos): Pos {
    return this.sample('tanks', id, rt, fallback);
  }

  /**
   * The newest position the server actually sent for a tank, and the tick it belongs to. This is the
   * anchor prediction replays from: everything after it is the client's own guess.
   */
  latestTankPos(id: number): { tick: number; x: number; y: number } | null {
    for (let i = this.frames.length - 1; i >= 0; i--) {
      const p = this.frames[i].tanks.get(id);
      if (p) return { tick: this.frames[i].t, x: p.x, y: p.y };
    }
    return null;
  }
  bulletPos(id: number, rt: number, fallback: Pos): Pos {
    return this.sample('bullets', id, rt, fallback);
  }
}
