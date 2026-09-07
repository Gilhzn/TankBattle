import { describe, expect, it } from 'vitest';
import { TILE, type Snapshot } from '@tank/shared';
import { InterpBuffer } from './interp.js';

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
  it('renders delayTicks behind the latest and never past it', () => {
    const b = new InterpBuffer(3);
    b.push(snap(30, 0, 0), 1000);
    expect(b.renderTick(1000)).toBe(27);
    expect(b.renderTick(1000 + 1000 / 30)).toBeCloseTo(28, 5);
    expect(b.renderTick(1000 + 10000)).toBe(30);
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
});
