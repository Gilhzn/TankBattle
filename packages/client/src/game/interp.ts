import { TICK_MS, TILE, type BulletDTO, type Snapshot, type TankDTO } from '@tank/shared';

export interface Pos {
  x: number;
  y: number;
}

interface Frame {
  t: number;
  arrivalMs: number;
  tanks: Map<number, Pos>;
  bullets: Map<number, Pos>;
}

/** Distance above which positions are snapped instead of interpolated (a respawn/teleport). */
export const SNAP_DISTANCE = TILE;

/**
 * Keeps the last N snapshots and produces smoothly interpolated entity positions
 * `delayTicks` behind the newest snapshot (0 for the local host = render the latest exactly).
 */
export class InterpBuffer {
  private frames: Frame[] = [];
  constructor(
    public delayTicks = 3,
    public size = 6,
  ) {}

  clear(): void {
    this.frames = [];
  }

  push(snap: Snapshot, nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now()): void {
    const last = this.frames[this.frames.length - 1];
    if (last && snap.t < last.t) this.frames = []; // new match / rewind
    if (last && snap.t === last.t) this.frames.pop();
    const tanks = new Map<number, Pos>();
    for (const t of snap.tanks as TankDTO[]) tanks.set(t[0], { x: t[3], y: t[4] });
    const bullets = new Map<number, Pos>();
    for (const b of snap.bullets as BulletDTO[]) bullets.set(b[0], { x: b[1], y: b[2] });
    this.frames.push({ t: snap.t, arrivalMs: nowMs, tanks, bullets });
    while (this.frames.length > this.size) this.frames.shift();
  }

  get latestTick(): number {
    return this.frames.length ? this.frames[this.frames.length - 1].t : 0;
  }

  /** The tick to render at `nowMs`: advances between snapshots but never past the newest one. */
  renderTick(nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now()): number {
    const last = this.frames[this.frames.length - 1];
    if (!last) return 0;
    if (this.delayTicks <= 0) return last.t;
    const elapsed = (nowMs - last.arrivalMs) / TICK_MS;
    return Math.min(last.t, last.t - this.delayTicks + Math.max(0, elapsed));
  }

  private bounds(rt: number): [Frame | null, Frame | null] {
    let a: Frame | null = null;
    let b: Frame | null = null;
    for (const f of this.frames) {
      if (f.t <= rt) a = f;
      if (f.t >= rt) {
        b = f;
        break;
      }
    }
    return [a, b];
  }

  private sample(kind: 'tanks' | 'bullets', id: number, rt: number, fallback: Pos): Pos {
    const [a, b] = this.bounds(rt);
    const pa = a?.[kind].get(id);
    const pb = b?.[kind].get(id);
    if (pa && pb && a && b) {
      if (a === b || b.t === a.t) return pb;
      if (Math.abs(pb.x - pa.x) > SNAP_DISTANCE || Math.abs(pb.y - pa.y) > SNAP_DISTANCE) return pb;
      const f = (rt - a.t) / (b.t - a.t);
      return { x: pa.x + (pb.x - pa.x) * f, y: pa.y + (pb.y - pa.y) * f };
    }
    return pb ?? pa ?? fallback;
  }

  tankPos(id: number, rt: number, fallback: Pos): Pos {
    return this.sample('tanks', id, rt, fallback);
  }
  bulletPos(id: number, rt: number, fallback: Pos): Pos {
    return this.sample('bullets', id, rt, fallback);
  }
}
