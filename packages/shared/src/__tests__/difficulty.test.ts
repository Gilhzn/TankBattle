import { describe, expect, it } from 'vitest';
import { createInitialState } from '../sim/state.js';
import { step } from '../sim/step.js';
import { spawnInterval } from '../sim/enemies.js';
import { DIFFICULTY } from '../constants.js';
import type { Difficulty } from '../types.js';

/** A fixed, deliberately average bot so the three levels are compared on equal terms. */
function survive(seed: number, difficulty: Difficulty): { ticks: number; deaths: number } {
  const state = createInitialState(seed, 1, [{ id: 'p', name: 'P' }], 'coop', difficulty);
  let dir = 0;
  let rng = seed >>> 0;
  const rnd = (): number => ((rng = (rng * 1103515245 + 12345) >>> 0) / 4294967296);
  for (let t = 0; t < 30 * 90 && state.status !== 'gameOver'; t++) {
    if (t % 12 === 0) dir = rnd() < 0.45 ? 0 : Math.floor(rnd() * 4);
    // Firing downward or along the base row destroys your own base, which would swamp the signal.
    const me = state.tanks.find((tk) => tk.kind === 'player');
    step(state, [{ dir: dir as 0 | 1 | 2 | 3, fire: !!me && me.y < 1300 && dir !== 2 && rnd() < 0.35 }]);
  }
  return { ticks: state.tick, deaths: state.players[0].deaths };
}

describe('difficulty', () => {
  it('defaults to normal', () => {
    expect(createInitialState(1, 1, [{ id: 'a', name: 'A' }]).difficulty).toBe('normal');
  });

  it('normal is gentler than hard, and easy gentler still', () => {
    const seeds = [11, 977, 4242, 90210, 31337, 5150, 8080, 12321];
    const totals = (d: Difficulty) => seeds.map((s) => survive(s, d)).reduce((a, r) => ({ ticks: a.ticks + r.ticks, deaths: a.deaths + r.deaths }), { ticks: 0, deaths: 0 });
    const easy = totals('easy');
    const normal = totals('normal');
    const hard = totals('hard');
    // Players last longer and die less often as the level drops.
    expect(normal.ticks).toBeGreaterThan(hard.ticks);
    expect(easy.ticks).toBeGreaterThan(normal.ticks);
    // Deaths are rarer than base losses, so over a short sample assert direction, not a strict drop.
    expect(normal.deaths).toBeLessThanOrEqual(hard.deaths);
  });

  it('scales the knobs that make the game hard', () => {
    expect(DIFFICULTY.normal.fire).toBeLessThan(DIFFICULTY.hard.fire);
    expect(DIFFICULTY.normal.lives).toBeGreaterThan(DIFFICULTY.hard.lives);
    // Reinforcements arrive further apart on the easier levels.
    const gap = (d: Difficulty): number => spawnInterval(createInitialState(1, 1, [{ id: 'a', name: 'A' }], 'coop', d));
    expect(gap('normal')).toBeGreaterThan(gap('hard'));
    expect(gap('easy')).toBeGreaterThan(gap('normal'));
  });

  it('stays deterministic per difficulty', () => {
    for (const d of ['easy', 'normal', 'hard'] as Difficulty[]) {
      expect(survive(4242, d)).toEqual(survive(4242, d));
    }
  });
});
