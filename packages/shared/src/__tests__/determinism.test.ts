import { describe, expect, it } from 'vitest';
import { createInitialState, hashState, cloneState } from '../sim/state.js';
import { step } from '../sim/step.js';
import { Rng } from '../rng.js';
import type { Input } from '../types.js';
import { simulateReplay, type Replay } from '../replay.js';
import { applySnapshot, createViewState, encodeSnapshot } from '../snapshot.js';
import { encodeTiles } from '../grid.js';

function scriptedInputs(seed: number, ticks: number, players: number): Input[][] {
  const rng = new Rng(seed);
  const frames: Input[][] = [];
  let current: Input[] = Array.from({ length: players }, () => ({ dir: -1, fire: false }));
  for (let t = 0; t < ticks; t++) {
    if (t % 15 === 0) current = current.map(() => {
      const dir = (rng.int(5) - 1) as Input['dir'];
      return { dir, fire: dir === 0 && rng.int(2) === 0 };
    });
    frames.push(current.map((c) => ({ ...c })));
  }
  return frames;
}

describe('determinism', () => {
  it('same seed + inputs => identical state hash after 2000 ticks', () => {
    const inputs = scriptedInputs(99, 2000, 2);
    const players = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
    const a = createInitialState(777, 1, players, 'coop', 'hard');
    const b = createInitialState(777, 1, players, 'coop', 'hard');
    for (const frame of inputs) {
      step(a, frame);
      step(b, frame);
    }
    expect(hashState(a)).toBe(hashState(b));
    expect(a.tick).toBe(2000);
    // and something actually happened
    expect(a.enemies.spawned).toBeGreaterThan(3);
  });
  it('different seeds diverge', () => {
    const inputs = scriptedInputs(5, 600, 1);
    const a = createInitialState(1, 1, [{ id: 'a', name: 'A' }]);
    const b = createInitialState(2, 1, [{ id: 'a', name: 'A' }]);
    for (const frame of inputs) {
      step(a, frame);
      step(b, frame);
    }
    expect(hashState(a)).not.toBe(hashState(b));
  });
  it('cloneState produces an independent equal copy', () => {
    const s = createInitialState(5, 3, [{ id: 'a', name: 'A' }]);
    for (let i = 0; i < 100; i++) step(s, [{ dir: 0, fire: true }]);
    const c = cloneState(s);
    expect(hashState(c)).toBe(hashState(s));
    step(c, [{ dir: 1, fire: false }]);
    expect(hashState(c)).not.toBe(hashState(s));
  });
  it('simulateReplay reproduces a live run', () => {
    const frames = scriptedInputs(12, 900, 1);
    const live = createInitialState(4242, 2, [{ id: 'p0', name: 'P1' }]);
    for (const f of frames) step(live, f);
    const replay: Replay = { seed: 4242, stage: 2, players: 1, inputs: frames.map((f) => f.map((i) => [i.dir, i.fire ? 1 : 0] as [number, number])) };
    const replayed = simulateReplay(replay);
    expect(hashState(replayed)).toBe(hashState(live));
    expect(replayed.players[0].score).toBe(live.players[0].score);
  });
  it('applying deltas yields the same view as a full snapshot', () => {
    const frames = scriptedInputs(8, 400, 1);
    const s = createInitialState(31337, 1, [{ id: 'a', name: 'A' }]);
    const view = createViewState();
    applySnapshot(view, encodeSnapshot(s, true), false);
    s.tileChanges = [];
    for (let i = 0; i < frames.length; i++) {
      step(s, frames[i]);
      if (i % 2 === 1) {
        applySnapshot(view, encodeSnapshot(s, false), true);
        s.tileChanges = [];
      }
    }
    const full = encodeSnapshot(s, true);
    expect(encodeTiles(view.tiles)).toBe(full.tiles);
    expect(view.tanks).toEqual(full.tanks);
    expect(view.bullets).toEqual(full.bullets);
    expect(view.players).toEqual(full.players);
  });
  it('rejects a delta before any full snapshot', () => {
    const s = createInitialState(1, 1, [{ id: 'a', name: 'A' }]);
    expect(applySnapshot(createViewState(), encodeSnapshot(s, false), false)).toBe(false);
  });
});
