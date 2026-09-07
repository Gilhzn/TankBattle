import { STAGE_CLEAR_TICKS } from '../constants.js';
import type { GameState } from '../types.js';
import { loadStage } from './state.js';

export function checkStageStatus(state: GameState): void {
  if (state.status !== 'playing') return;
  if (state.mode === 'versus') {
    state.timeLeft--;
    // Last side standing wins. Everyone has a fixed number of eliminations, so a match normally ends
    // here; the clock is only the fallback for a stalemate where nobody can finish anybody off.
    const standing = new Set<number>();
    for (const p of state.players) {
      if (!p.active) continue;
      if (p.lives > 0 || p.tankId !== null) standing.add(p.team);
    }
    if (standing.size <= 1 && state.players.some((p) => p.active)) {
      state.status = 'gameOver';
      state.statusSince = state.tick;
      state.gameOverReason = 'eliminated';
      state.events.push({ type: 'gameOver', reason: 'eliminated' });
      return;
    }
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

/**
 * The side (or sides, on a tie) that won a versus match. Normally exactly one team is still
 * standing; when the clock runs out on a stalemate it falls back to the highest team score, which
 * can legitimately tie.
 */
export function versusWinningTeams(state: GameState): number[] {
  const active = state.players.filter((p) => p.active);
  if (!active.length) return [];
  const standing = new Set(active.filter((p) => p.lives > 0 || p.tankId !== null).map((p) => p.team));
  if (standing.size === 1) return [...standing];
  const scores = new Map<number, number>();
  for (const p of active) scores.set(p.team, (scores.get(p.team) ?? 0) + p.score);
  const best = Math.max(...scores.values());
  // A scoreless stalemate has no winner rather than four of them.
  if (best <= 0) return [];
  return [...scores.entries()].filter(([, v]) => v === best).map(([team]) => team);
}
