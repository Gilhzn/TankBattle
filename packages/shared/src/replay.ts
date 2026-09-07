import { createInitialState, hashState } from './sim/state.js';
import { step } from './sim/step.js';
import type { Command, GameState, Input } from './types.js';

export interface Replay {
  seed: number;
  stage: number;
  players: number;
  /** inputs[tick][slot] = [dir, fire] */
  inputs: Array<Array<[number, number]>>;
  /** Server-authorised commands (consumable boosts) keyed by the tick they were applied on. */
  commands?: Array<{ tick: number; command: Command }>;
}

export function simulateReplay(r: Replay, onTick?: (state: GameState) => void): GameState {
  const players = Array.from({ length: r.players }, (_, i) => ({ id: `p${i}`, name: `P${i + 1}` }));
  const state = createInitialState(r.seed, r.stage, players);
  const byTick = new Map<number, Command[]>();
  for (const c of r.commands ?? []) {
    const list = byTick.get(c.tick) ?? [];
    list.push(c.command);
    byTick.set(c.tick, list);
  }
  for (const frame of r.inputs) {
    const inputs: Input[] = frame.map(([dir, fire]) => ({ dir: dir as Input['dir'], fire: fire === 1 }));
    step(state, inputs, byTick.get(state.tick + 1) ?? []);
    onTick?.(state);
  }
  return state;
}

export function replayHash(r: Replay): number {
  return hashState(simulateReplay(r));
}
