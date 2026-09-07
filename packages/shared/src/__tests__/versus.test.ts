import { describe, expect, it } from 'vitest';
import { createInitialState, teamOf } from '../sim/state.js';
import { step } from '../sim/step.js';
import { killPlayerTank, playerTank, sameTeam } from '../sim/players.js';
import { TANK_SIZE, TILE, VERSUS_LIVES } from '../constants.js';
import { NONE } from './helpers.js';
import type { GameState, Input, PlayerSlot } from '../types.js';

const FOUR = [
  { id: 'a', name: 'A' },
  { id: 'b', name: 'B' },
  { id: 'c', name: 'C' },
  { id: 'd', name: 'D' },
];

const arena = (format: 'ffa' | 'teams' = 'ffa', players = FOUR): GameState =>
  createInitialState(7, 1, players, 'versus', 'normal', format);

const idle = (n: number): Input[] => Array.from({ length: n }, () => NONE);

/** Kills the player in `slot`, credited to `by`. */
function frag(s: GameState, slot: number, by: number): void {
  const tank = playerTank(s, s.players[slot]);
  if (!tank) throw new Error(`slot ${slot} has no tank`);
  killPlayerTank(s, tank, by);
}

describe('versus seats and teams', () => {
  it('gives every versus player three eliminations', () => {
    const s = arena();
    for (const p of s.players) expect(p.lives).toBe(VERSUS_LIVES);
  });

  it('puts every player on their own side in free-for-all', () => {
    const s = arena('ffa');
    expect(s.players.map((p) => p.team)).toEqual([0, 1, 2, 3]);
    expect(sameTeam(s.players[0], s.players[2])).toBe(false);
  });

  it('pairs alternating seats in 2v2 so teammates start apart', () => {
    const s = arena('teams');
    expect(s.players.map((p) => p.team)).toEqual([0, 1, 0, 1]);
    expect(sameTeam(s.players[0], s.players[2])).toBe(true);
    expect(sameTeam(s.players[0], s.players[1])).toBe(false);
  });

  it('leaves co-op players teamless', () => {
    const s = createInitialState(7, 1, FOUR, 'coop');
    for (const p of s.players) expect(p.team).toBe(-1);
    expect(teamOf(0, 'coop', 'teams')).toBe(-1);
  });
});

describe('versus eliminations', () => {
  it('spends a life per death and stops respawning at zero', () => {
    const s = arena();
    for (let i = 0; i < VERSUS_LIVES; i++) {
      expect(s.players[0].lives).toBe(VERSUS_LIVES - i);
      frag(s, 0, 1);
      // Long enough to cover the respawn delay.
      step(s, idle(4));
      for (let t = 0; t < 120; t++) step(s, idle(4));
    }
    expect(s.players[0].lives).toBe(0);
    expect(playerTank(s, s.players[0])).toBeUndefined();
  });

  it('announces the elimination on the last life', () => {
    const s = arena();
    s.players[0].lives = 1;
    const tank = playerTank(s, s.players[0])!;
    killPlayerTank(s, tank, 1);
    expect(s.events.find((e) => e.type === 'eliminated')).toMatchObject({ slot: 0, team: 0 });
  });

  it('ends the match when one player is left in free-for-all', () => {
    const s = arena();
    for (const slot of [1, 2, 3]) s.players[slot].lives = 1;
    for (const slot of [1, 2, 3]) frag(s, slot, 0);
    step(s, idle(4));
    expect(s.status).toBe('gameOver');
    expect(s.gameOverReason).toBe('eliminated');
  });

  it('ends the match when one whole team is out in 2v2, not when one player is', () => {
    const s = arena('teams');
    // Team 1 is seats 1 and 3. Knock out seat 1 only: the match continues.
    s.players[1].lives = 1;
    frag(s, 1, 0);
    step(s, idle(4));
    expect(s.status).toBe('playing');
    s.players[3].lives = 1;
    frag(s, 3, 0);
    step(s, idle(4));
    expect(s.status).toBe('gameOver');
    expect(s.gameOverReason).toBe('eliminated');
  });

  it('still ends on the clock if nobody can finish anybody off', () => {
    const s = arena();
    s.timeLeft = 2;
    step(s, idle(4));
    step(s, idle(4));
    expect(s.status).toBe('gameOver');
    expect(s.gameOverReason).toBe('time');
  });
});

describe('versus friendly fire', () => {
  /** Puts `shooter` one tile to the left of `target`, both facing right, and fires. */
  function lineUp(s: GameState, shooter: number, target: number): void {
    const a = playerTank(s, s.players[shooter])!;
    const b = playerTank(s, s.players[target])!;
    a.x = 4 * TILE;
    a.y = 10 * TILE;
    a.dir = 1;
    a.shieldUntil = 0;
    b.x = a.x + TANK_SIZE + TILE;
    b.y = a.y;
    b.shieldUntil = 0;
    for (const t of s.tanks) if (t !== a && t !== b) t.x = 20 * TILE;
    const inputs: Input[] = idle(4);
    inputs[shooter] = { dir: 1, fire: true };
    for (let i = 0; i < 20; i++) step(s, i === 0 ? inputs : idle(4));
  }

  it('a teammate is not hit in 2v2', () => {
    const s = arena('teams');
    const deaths = s.players[2].deaths;
    lineUp(s, 0, 2); // seats 0 and 2 share team 0
    expect(s.players[2].deaths).toBe(deaths);
    expect(s.players[2].lives).toBe(VERSUS_LIVES);
  });

  it('an opponent is hit in 2v2', () => {
    const s = arena('teams');
    lineUp(s, 0, 1); // seat 1 is on team 1
    expect(s.players[1].deaths).toBe(1);
    expect(s.players[1].lives).toBe(VERSUS_LIVES - 1);
    expect(s.players[0].kills).toBe(1);
  });

  it('everyone is a target in free-for-all', () => {
    const s = arena('ffa');
    lineUp(s, 0, 2);
    expect(s.players[2].deaths).toBe(1);
    expect(s.players[0].kills).toBe(1);
  });

  it('a teammate kill earns no score', () => {
    const s = arena('teams');
    const p0 = s.players[0] as PlayerSlot;
    const before = p0.score;
    frag(s, 2, 0); // seat 2 is a teammate of seat 0
    expect(p0.kills).toBe(0);
    expect(p0.score).toBe(before);
  });
});
