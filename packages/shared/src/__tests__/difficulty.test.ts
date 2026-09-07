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
    // The bot fires freely: a player's own shell can no longer take the base, so friendly fire
    // is not a confound and the surviving signal is the AI pressure the difficulty sets.
    step(state, [{ dir: dir as 0 | 1 | 2 | 3, fire: rnd() < 0.35 }]);
  }
  return { ticks: state.tick, deaths: state.players[0].deaths };
}

describe('difficulty', () => {
  it('defaults to normal', () => {
    expect(createInitialState(1, 1, [{ id: 'a', name: 'A' }]).difficulty).toBe('normal');
  });

  it('normal is gentler than hard, and easy gentler still', () => {
    // A single run is dominated by where the bot happens to wander, so the levels are compared
    // over a spread of seeds. Eight was inside the noise; twenty separates them by ~1.5x each step.
    const seeds = Array.from({ length: 20 }, (_, i) => 11 + i * 977);
    const total = (d: Difficulty): number => seeds.reduce((a, s) => a + survive(s, d).ticks, 0);
    const easy = total('easy');
    const normal = total('normal');
    const hard = total('hard');
    // Each step down the ladder must buy real survival time, not a rounding-error's worth.
    expect(normal).toBeGreaterThan(hard * 1.2);
    expect(easy).toBeGreaterThan(normal * 1.2);
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
