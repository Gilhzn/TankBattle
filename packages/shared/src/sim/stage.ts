import { STAGE_CLEAR_TICKS } from '../constants.js';
import type { GameState } from '../types.js';
import { loadStage } from './state.js';

export function checkStageStatus(state: GameState): void {
  if (state.status !== 'playing') return;
  if (state.mode === 'versus') {
    state.timeLeft--;
    if (state.timeLeft <= 0) {
      state.status = 'gameOver';
      state.statusSince = state.tick;
      state.gameOverReason = 'time';
      state.events.push({ type: 'gameOver', reason: 'time' });
    }
    return;
  }
  if (!state.baseAlive) {
    state.status = 'gameOver';
    state.statusSince = state.tick;
    state.gameOverReason = 'base';
    state.events.push({ type: 'gameOver', reason: 'base' });
    return;
  }
  const active = state.players.filter((p) => p.active);
  const anyAlive = active.some((p) => p.tankId !== null || p.lives > 0);
  if (active.length > 0 && !anyAlive) {
    state.status = 'gameOver';
    state.statusSince = state.tick;
    state.gameOverReason = 'lives';
    state.events.push({ type: 'gameOver', reason: 'lives' });
    return;
  }
  const e = state.enemies;
  const noEnemiesLeft = e.queue.length === 0 && !state.tanks.some((t) => t.kind !== 'player');
  if (noEnemiesLeft && e.killed >= e.total) {
    state.status = 'stageClear';
    state.statusSince = state.tick;
    state.events.push({ type: 'stageClear', stage: state.stage });
  }
}

export function advanceStageIfReady(state: GameState): void {
  if (state.status !== 'stageClear') return;
  if (state.tick - state.statusSince >= STAGE_CLEAR_TICKS) {
    loadStage(state, state.stage + 1);
  }
}
