import type { Command, GameState, Input, TickEvent } from '../types.js';
import { applyCommand } from './commands.js';
import { spawnEnemies, updateEnemies } from './enemies.js';
import { updateBullets } from './bullets.js';
import { updatePlayers } from './players.js';
import { updatePowerUps, updateShovel } from './powerups.js';
import { advanceStageIfReady, checkStageStatus } from './stage.js';

/**
 * Advances the simulation by exactly one tick. Deterministic: same state + inputs + commands => same result.
 * Returns the events produced during this tick (also left on state.events).
 */
export function step(state: GameState, inputs: ReadonlyArray<Input | null | undefined>, commands: ReadonlyArray<Command> = []): TickEvent[] {
  state.events = [];
  state.tick++;
  for (const c of commands) applyCommand(state, c);
  if (state.status === 'playing') {
    updateShovel(state);
    spawnEnemies(state);
    updatePlayers(state, inputs);
    updateEnemies(state);
    updateBullets(state);
    updatePowerUps(state);
    checkStageStatus(state);
  } else if (state.status === 'stageClear') {
    advanceStageIfReady(state);
  }
  return state.events;
}
