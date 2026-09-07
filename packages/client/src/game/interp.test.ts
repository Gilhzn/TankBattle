import { describe, expect, it } from 'vitest';
import { TICK_MS, TILE, type BulletDTO, type Snapshot, type TankDTO } from '@tank/shared';
import { InterpBuffer, type Pos as _Pos } from './interp.js';

function snap(t: number, x: number, y: number, bx = 0): Snapshot {
  return {
    t,
    full: true,
    stage: 1,
    mode: 'coop',
    status: 'playing',
    tanks: [[1, 0, 'player', x, y, 0, 0, 1, 1, 0, 'default']],
    bullets: [[7, bx, 100, 1, 1, 32]],
    powerUp: null,
    players: [],
    enemies: { remaining: 0, killed: 0, total: 0, onScreen: 0 },
    effects: { freeze: 0, playerFreeze: 0, shovel: 0 },
    baseAlive: true,
    timeLeft: 0,
    gameOverReason: null,
    events: [],
  };
}

describe('InterpBuffer', () => {
  it('interpolates linearly between bounding snapshots by entity id', () => {
    const b = new InterpBuffer(3);
    b.push(snap(10, 0, 0, 0), 0);
    b.push(snap(20, 40, 20, 100), 100);
    expect(b.tankPos(1, 15, { x: -1, y: -1 })).toEqual({ x: 20, y: 10 });
    expect(b.bulletPos(7, 12, { x: -1, y: -1 })).toEqual({ x: 20, y: 100 });
  });
  it('snaps when the jump is larger than a tile', () => {
    const b = new InterpBuffer(3);
    b.push(snap(10, 0, 0), 0);
    b.push(snap(12, TILE * 5, 0), 0);
    expect(b.tankPos(1, 11, { x: -1, y: -1 })).toEqual({ x: TILE * 5, y: 0 });
  });
  it('renders delayTicks behind the estimated server tick and never runs far past the newest', () => {
    const b = new InterpBuffer(3);
    b.push(snap(30, 0, 0), 1000);
    expect(b.renderTick(1000)).toBe(27);
    expect(b.renderTick(1000 + 1000 / 30)).toBeCloseTo(28, 5);
    // With no further snapshots the head is held just past the newest tick instead of being hard
    // clamped to it. Positions hold at the newest known value either way (there is nothing to
    // interpolate towards), but the small margin means the very next snapshot resumes
    // interpolation instead of the head having to be dragged forward again.
    expect(b.renderTick(1000 + 10000)).toBe(32);
    const local = new InterpBuffer(0);
    local.push(snap(30, 0, 0), 1000);
    expect(local.renderTick(1000)).toBe(30);
  });
  it('smooths a 30 Hz sim across display frames with one tick of delay (solo play)', () => {
    // What the local host produces: one snapshot per tick, the tank moving a fixed step.
    const b = new InterpBuffer(1);
    const TICK = 1000 / 30;
    b.push(snap(10, 100, 0), 0);
    b.push(snap(11, 116, 0), TICK);

    // Sampling across the tick must yield strictly increasing intermediate positions rather than
    // holding one value and jumping — that hold is what read as stutter.
    const xs = [0, 0.25, 0.5, 0.75].map((f) => b.tankPos(1, b.renderTick(TICK + f * TICK), { x: -1, y: -1 }).x);
    expect(xs[0]).toBeCloseTo(100, 5);
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1]);
    expect(xs[xs.length - 1]).toBeLessThan(116);
    expect(Math.max(...xs)).toBeLessThanOrEqual(116);
  });

  it('falls back for entities missing from one side and keeps only the last N frames', () => {
    const b = new InterpBuffer(3, 3);
    for (let t = 0; t < 10; t++) b.push(snap(t * 2, t, t), t);
    expect(b.latestTick).toBe(18);
    expect(b.tankPos(99, 17, { x: 5, y: 6 })).toEqual({ x: 5, y: 6 });
    // rewinding (new match) clears the buffer
    b.push(snap(1, 3, 3), 100);
    expect(b.latestTick).toBe(1);
  });

  it('ignores duplicate snapshots and repairs out-of-order ones without dropping the buffer', () => {
    const b = new InterpBuffer(3, 8);
    b.push(snap(10, 0, 0), 0);
    b.push(snap(12, 16, 0), 66);
    b.push(snap(12, 16, 0), 70); // duplicate
    b.push(snap(16, 48, 0), 200); // gap: 14 is late
    b.push(snap(14, 32, 0), 201); // ...and arrives after 16
    expect(b.latestTick).toBe(16);
    // 14 was slotted between 12 and 16, so the segment 12..16 interpolates through it
    expect(b.tankPos(1, 13, { x: -1, y: -1 }).x).toBeCloseTo(24, 5);
    expect(b.tankPos(1, 15, { x: -1, y: -1 }).x).toBeCloseTo(40, 5);
    // a duplicate must not move the playout head twice
    expect(b.stats.frames).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Jitter benchmark: the same arrival trace through the old arrival-anchored
// playout and the new clock-driven one.
// ---------------------------------------------------------------------------

/** The playout this change replaces: render time re-anchored to the newest snapshot's arrival. */
class LegacyBuffer {
  private frames: Array<{ t: number; arrivalMs: number; tanks: Map<number, _Pos>; bullets: Map<number, _Pos> }> = [];
  constructor(
    public delayTicks = 3,
    public size = 8,
  ) {}
  push(s: Snapshot, nowMs: number): void {
    const last = this.frames[this.frames.length - 1];
    if (last && s.t < last.t) this.frames = [];
    if (last && s.t === last.t) this.frames.pop();
    const tanks = new Map<number, _Pos>();
    for (const t of s.tanks as TankDTO[]) tanks.set(t[0], { x: t[3], y: t[4] });
    const bullets = new Map<number, _Pos>();
    for (const b of s.bullets as BulletDTO[]) bullets.set(b[0], { x: b[1], y: b[2] });
    this.frames.push({ t: s.t, arrivalMs: nowMs, tanks, bullets });
    while (this.frames.length > this.size) this.frames.shift();
  }
  renderTick(nowMs: number): number {
    const last = this.frames[this.frames.length - 1];
    if (!last) return 0;
    if (this.delayTicks <= 0) return last.t;
    const elapsed = (nowMs - last.arrivalMs) / TICK_MS;
    return Math.min(last.t, last.t - this.delayTicks + Math.max(0, elapsed));
  }
  tankPos(id: number, rt: number, fallback: _Pos): _Pos {
    let a = null as null | { t: number; tanks: Map<number, _Pos> };
    let b = null as null | { t: number; tanks: Map<number, _Pos> };
    for (const f of this.frames) {
      if (f.t <= rt) a = f;
      if (f.t >= rt) {
        b = f;
        break;
      }
    }
    const pa = a?.tanks.get(id);
    const pb = b?.tanks.get(id);
    if (pa && pb && a && b && a !== b && b.t !== a.t) {
      if (Math.abs(pb.x - pa.x) > TILE || Math.abs(pb.y - pa.y) > TILE) return pb;
      const f = (rt - a.t) / (b.t - a.t);
      return { x: pa.x + (pb.x - pa.x) * f, y: pa.y + (pb.y - pa.y) * f };
    }
    return pb ?? pa ?? fallback;
  }
}

interface Playout {
  push(s: Snapshot, nowMs: number): void;
  renderTick(nowMs: number): number;
  tankPos(id: number, rt: number, fallback: _Pos): _Pos;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SNAP_EVERY = 2; // server sends every 2nd tick (15 Hz at TICK_RATE 30)
const SPEED = 8; // sub-units per tick — a player tank's speed, well under SNAP_DISTANCE per segment

interface Arrival {
  at: number;
  snap: Snapshot;
}

/**
 * A TCP-like arrival trace: base latency plus per-packet jitter, occasional 150 ms stalls, and
 * strictly increasing arrival times (so a stall is followed by a burst of queued snapshots).
 */
function makeTrace(seed: number, snapshots: number, opts: { jitterMs: number; stallEvery: number; stallMs: number }): Arrival[] {
  const rnd = mulberry32(seed);
  const out: Arrival[] = [];
  let prevArrival = -Infinity;
  for (let i = 0; i < snapshots; i++) {
    const tick = i * SNAP_EVERY;
    const emitted = tick * TICK_MS;
    // triangular jitter (sum of two uniforms) around a 40 ms base latency
    const jitter = (rnd() + rnd() - 1) * opts.jitterMs;
    const stall = opts.stallEvery > 0 && i > 0 && i % opts.stallEvery === 0 ? opts.stallMs : 0;
    const at = Math.max(prevArrival + 0.01, emitted + 40 + jitter + stall);
    prevArrival = at;
    out.push({ at, snap: snap(tick, tick * SPEED, 0) });
  }
  return out;
}

interface Metrics {
  frames: number;
  zeroFrames: number;
  backwards: number;
  meanDelta: number;
  stdDelta: number;
  cv: number;
  maxDelta: number;
  travelled: number;
}

/** Runs a playout over a trace, sampling once per display frame (60 Hz). */
function measure(buf: Playout, trace: Arrival[], frameMs = 1000 / 60, warmupMs = 500): Metrics {
  const end = trace[trace.length - 1].at;
  const xs: number[] = [];
  let next = 0;
  for (let now = trace[0].at; now <= end; now += frameMs) {
    while (next < trace.length && trace[next].at <= now) buf.push(trace[next++].snap, trace[next - 1].at);
    const x = buf.tankPos(1, buf.renderTick(now), { x: 0, y: 0 }).x;
    if (now - trace[0].at >= warmupMs) xs.push(x);
  }
  const deltas: number[] = [];
  for (let i = 1; i < xs.length; i++) deltas.push(xs[i] - xs[i - 1]);
  const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  const variance = deltas.reduce((a, b) => a + (b - mean) ** 2, 0) / deltas.length;
  const std = Math.sqrt(variance);
  return {
    frames: xs.length,
    zeroFrames: deltas.filter((d) => Math.abs(d) < mean * 0.02).length,
    backwards: deltas.filter((d) => d < -1e-9).length,
    meanDelta: mean,
    stdDelta: std,
    cv: std / mean,
    maxDelta: Math.max(...deltas),
    travelled: xs[xs.length - 1] - xs[0],
  };
}

describe('InterpBuffer under network jitter', () => {
  const cases = [
    { name: 'mild jitter (±15 ms)', opts: { jitterMs: 15, stallEvery: 0, stallMs: 0 } },
    { name: 'heavy jitter (±40 ms)', opts: { jitterMs: 40, stallEvery: 0, stallMs: 0 } },
    { name: 'jitter + 150 ms stalls every ~1 s', opts: { jitterMs: 25, stallEvery: 15, stallMs: 150 } },
  ];

  for (const c of cases) {
    it(`renders smoothly with ${c.name}`, () => {
      const trace = makeTrace(1234, 150, c.opts); // 150 snapshots ≈ 10 s
      const legacy = measure(new LegacyBuffer(3, 8), trace);
      const fixed = measure(new InterpBuffer(3, 14), trace);
      // eslint-disable-next-line no-console
      console.log(
        `[${c.name}] legacy: zero=${legacy.zeroFrames}/${legacy.frames} cv=${legacy.cv.toFixed(3)} std=${legacy.stdDelta.toFixed(3)} max=${legacy.maxDelta.toFixed(2)} back=${legacy.backwards} | fixed: zero=${fixed.zeroFrames}/${fixed.frames} cv=${fixed.cv.toFixed(3)} std=${fixed.stdDelta.toFixed(3)} max=${fixed.maxDelta.toFixed(2)} back=${fixed.backwards}`,
      );

      // 1. Motion is monotonic: no rendered step ever goes backwards.
      expect(fixed.backwards).toBe(0);
      // 2. No frozen frames: every display frame advances (the freeze/jump pattern is gone).
      expect(fixed.zeroFrames).toBe(0);
      // 3. Per-frame delta is near-constant. The playout rate is limited to ±12 % of real time, so
      //    the spread of per-frame steps cannot exceed that by much.
      expect(fixed.cv).toBeLessThan(0.15);
      // 4. No step is much larger than the average one (no catch-up jumps).
      expect(fixed.maxDelta).toBeLessThan(fixed.meanDelta * 1.35);
      // 5. It still tracks the simulation: the tank crosses the field at the simulated speed
      //    (SPEED per tick = SPEED/2 per 60 Hz frame), so the smoothing is not just lag.
      expect(fixed.meanDelta).toBeGreaterThan(SPEED * 0.5 * 0.96);
      expect(fixed.meanDelta).toBeLessThan(SPEED * 0.5 * 1.04);
      // 6. Strictly better than what it replaces.
      expect(fixed.cv).toBeLessThan(legacy.cv / 3);
      expect(fixed.zeroFrames).toBeLessThanOrEqual(legacy.zeroFrames);
      expect(fixed.maxDelta).toBeLessThan(legacy.maxDelta);
    });
  }

  it('keeps the delay at the configured minimum on a steady link and grows it only when jittery', () => {
    const steady = new InterpBuffer(3, 14);
    for (const a of makeTrace(7, 120, { jitterMs: 1, stallEvery: 0, stallMs: 0 })) steady.push(a.snap, a.at);
    expect(steady.effectiveDelay).toBeLessThan(3.2);

    const rough = new InterpBuffer(3, 14);
    for (const a of makeTrace(7, 120, { jitterMs: 30, stallEvery: 10, stallMs: 150 })) rough.push(a.snap, a.at);
    expect(rough.effectiveDelay).toBeGreaterThan(4);
    expect(rough.effectiveDelay).toBeLessThanOrEqual(8); // bounded: 3 + at most 5 ticks (267 ms total)

    // ...and it comes back down once the link settles, so a good connection stays responsive.
    let t = 120 * SNAP_EVERY;
    let at = rough.stats.latestTick * TICK_MS + 40;
    for (let i = 0; i < 200; i++) {
      t += SNAP_EVERY;
      at += SNAP_EVERY * TICK_MS;
      rough.push(snap(t, t * SPEED, 0), at);
    }
    expect(rough.effectiveDelay).toBeLessThan(3.5);
  });

  it('glides a bounded distance instead of stalling when the buffer runs dry', () => {
    const b = new InterpBuffer(3, 14);
    const xs: number[] = [];
    let now = 0;
    let at = 40;
    let t = 0;
    const sampleUntil = (until: number): void => {
      for (; now <= until; now += 1000 / 60) xs.push(b.tankPos(1, b.renderTick(now), { x: 0, y: 0 }).x);
    };
    for (; t < 30; t += SNAP_EVERY) {
      b.push(snap(t, t * SPEED, 0), at);
      at += SNAP_EVERY * TICK_MS;
      sampleUntil(at);
    }
    const outageStart = xs.length;
    // 500 ms of loss: the server keeps simulating, we hear nothing.
    at += 500;
    t += Math.round(500 / TICK_MS / SNAP_EVERY) * SNAP_EVERY;
    sampleUntil(at);
    const during = xs.slice(outageStart);
    const newest = 28 * SPEED;
    // Never frozen for the first frames of the gap, and never further than the strict cap.
    expect(during[0]).toBeGreaterThan(xs[outageStart - 1]);
    expect(Math.max(...during)).toBeLessThanOrEqual(newest + 2 * SPEED + 1e-9);
    expect(Math.max(...during)).toBeGreaterThan(newest); // it glided rather than stopping dead
    // Data resumes; the head catches up without ever running backwards.
    for (let i = 0; i < 40; i++) {
      b.push(snap(t, t * SPEED, 0), at);
      t += SNAP_EVERY;
      at += SNAP_EVERY * TICK_MS;
      sampleUntil(at);
    }
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThanOrEqual(xs[i - 1] - 1e-9);
    // and it is tracking the live stream again at the end
    expect(xs[xs.length - 1]).toBeGreaterThan((t - SNAP_EVERY - 8) * SPEED);
  });

  it('survives duplicate and bursty arrivals without freezing', () => {
    const trace = makeTrace(99, 120, { jitterMs: 20, stallEvery: 8, stallMs: 120 });
    const dup: Arrival[] = [];
    for (const a of trace) {
      dup.push(a);
      if (a.snap.t % 6 === 0) dup.push({ at: a.at + 0.5, snap: a.snap }); // re-delivered packet
    }
    const m = measure(new InterpBuffer(3, 14), dup);
    expect(m.backwards).toBe(0);
    expect(m.zeroFrames).toBe(0);
    expect(m.cv).toBeLessThan(0.15);
  });
});
