import { createInitialState, type PlayerInit } from '../sim/state.js';
import { step } from '../sim/step.js';
import type { Command, GameState, Input, Tank } from '../types.js';
import { playerTank } from '../sim/players.js';

export const NONE: Input = { dir: -1, fire: false };
export const UP: Input = { dir: 0, fire: false };
export const RIGHT: Input = { dir: 1, fire: false };
export const DOWN: Input = { dir: 2, fire: false };
export const LEFT: Input = { dir: 3, fire: false };
export const FIRE: Input = { dir: -1, fire: true };

export function makeState(seed = 42, stage = 1, players: PlayerInit[] = [{ id: 'a', name: 'A' }], mode: 'coop' | 'versus' = 'coop'): GameState {
  return createInitialState(seed, stage, players, mode);
}

export function run(state: GameState, ticks: number, inputs: (Input | null)[] = [NONE], commands: Command[] = []): void {
  for (let i = 0; i < ticks; i++) step(state, inputs, i === 0 ? commands : []);
}

export function p0Tank(state: GameState): Tank {
  const t = playerTank(state, state.players[0]);
  if (!t) throw new Error('player 0 has no tank');
  return t;
}

/** Removes all enemies and empties the queue so tests can focus on one mechanic. */
export function clearEnemies(state: GameState): void {
  state.tanks = state.tanks.filter((t) => t.kind === 'player');
  state.enemies.queue = [];
  state.enemies.nextSpawnTick = Number.MAX_SAFE_INTEGER;
}

export function fillTiles(state: GameState, fn: (tx: number, ty: number) => number | undefined): void {
  for (let ty = 0; ty < 26; ty++) for (let tx = 0; tx < 26; tx++) {
    const v = fn(tx, ty);
    if (v !== undefined) state.tiles[ty * 26 + tx] = v;
  }
}
