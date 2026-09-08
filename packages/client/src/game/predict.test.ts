import { describe, expect, it } from 'vitest';
import {
  createInitialState, encodeSnapshot, applySnapshot, createViewState, PLAYER_SPEED, step, TILE,
  type Input, type TankDTO, type ViewState,
} from '@tank/shared';
import { Predictor } from './predict.js';

const PLAYERS = [{ id: 'a', name: 'A' }];

/** A view of a fresh solo stage, plus the local tank's DTO. */
function freshView(): { view: ViewState; mine: TankDTO } {
  const state = createInitialState(7, 0, PLAYERS, 'coop', 'normal');
  const view = createViewState();
  applySnapshot(view, encodeSnapshot(state, true));
  const mine = (view.tanks as TankDTO[]).find((t) => t[2] === 'player')!;
  return { view, mine };
}

/** What the server would do with the same inputs, so the two can be compared exactly. */
function serverAfter(ticks: number, input: Input): { x: number; y: number } {
  const state = createInitialState(7, 0, PLAYERS, 'coop', 'normal');
  for (let i = 0; i < ticks; i++) step(state, [input]);
  const tank = state.tanks.find((t) => t.kind === 'player')!;
  return { x: tank.x, y: tank.y };
}

describe('local prediction', () => {
  it('lands exactly where the server will, because it replays the server\'s own movement code', () => {
    const { view, mine } = freshView();
    const p = new Predictor();
    p.push({ dir: 0, fire: false }, 0);
    // 8 ticks of holding "up", predicted from tick 0 with no correction in between.
    const out = p.predict(view, mine, { tick: 0, x: mine[3], y: mine[4] }, 8, 16);
    expect(out).not.toBeNull();
    expect({ x: Math.round(out!.x), y: Math.round(out!.y) }).toEqual(serverAfter(8, { dir: 0, fire: false }));
  });

  it('does not move a tank whose player is not pressing anything', () => {
    const { view, mine } = freshView();
    const p = new Predictor();
    const out = p.predict(view, mine, { tick: 0, x: mine[3], y: mine[4] }, 10, 16)!;
    expect(out.x).toBe(mine[3]);
    expect(out.y).toBe(mine[4]);
    expect(out.moving).toBe(false);
  });

  it('applies an input from the tick it was given, not the tick after', () => {
    const { view, mine } = freshView();
    const p = new Predictor();
    p.push({ dir: 0, fire: false }, 4);
    const out = p.predict(view, mine, { tick: 3, x: mine[3], y: mine[4] }, 4, 16)!;
    // One tick of movement: the tick stamped 4 counts, so pressing costs no extra tick of delay.
    expect(mine[4] - out.y).toBe(PLAYER_SPEED);
  });

  it('stops at a wall rather than predicting through it', () => {
    const { view, mine } = freshView();
    const p = new Predictor();
    p.push({ dir: 2, fire: false }, 0);
    // Straight down from the co-op spawn is the bottom edge, a few ticks away.
    const out = p.predict(view, mine, { tick: 0, x: mine[3], y: mine[4] }, 40, 16)!;
    expect(out.y).toEqual(serverAfter(40, { dir: 2, fire: false }).y);
    expect(out.moving).toBe(false);
  });

  it('eases a small correction instead of snapping the tank sideways', () => {
    const { view, mine } = freshView();
    const p = new Predictor();
    p.push({ dir: 1, fire: false }, 0);
    const first = p.predict(view, mine, { tick: 0, x: mine[3], y: mine[4] }, 6, 16)!;
    // The server disagrees by a third of a tile: the drawn position must move toward it, not to it.
    const corrected = p.predict(view, mine, { tick: 6, x: first.x - TILE / 3, y: first.y }, 6, 16)!;
    expect(corrected.x).toBeLessThan(first.x);
    expect(corrected.x).toBeGreaterThan(first.x - TILE / 3);
  });

  it('snaps when the correction is a teleport, because sliding there would be a lie', () => {
    const { view, mine } = freshView();
    const p = new Predictor();
    p.predict(view, mine, { tick: 0, x: mine[3], y: mine[4] }, 0, 16);
    const far = { tick: 1, x: mine[3] + TILE * 4, y: mine[4] };
    const out = p.predict(view, mine, far, 1, 16)!;
    expect(out.x).toBe(far.x);
  });

  it('forgets the input log when the match rewinds, so old ticks cannot drive a new game', () => {
    const { view, mine } = freshView();
    const p = new Predictor();
    p.push({ dir: 0, fire: false }, 200);
    p.predict(view, mine, { tick: 200, x: mine[3], y: mine[4] }, 208, 16);
    const out = p.predict(view, mine, { tick: 2, x: mine[3], y: mine[4] }, 10, 16)!;
    expect(out.x).toBe(mine[3]);
    expect(out.y).toBe(mine[4]);
  });

  it('leads by a whole round trip, and never by more than its cap', () => {
    expect(Predictor.leadTicks(0)).toBe(0);
    expect(Predictor.leadTicks(66)).toBe(2);
    expect(Predictor.leadTicks(240)).toBe(7);
    expect(Predictor.leadTicks(5000)).toBe(10);
  });
});
