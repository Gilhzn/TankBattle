import { CLOCK_TICKS, MAX_LIVES, STARTING_LIVES, VERSUS_LIVES } from '../constants.js';
import type { Command, GameState } from '../types.js';
import { grenade } from './powerups.js';
import { playerTank, spawnPlayerTank, upgradePlayer } from './players.js';
import { teamOf } from './state.js';

/**
 * Consumables that would decide a duel rather than colour it. Blocked in versus for the same reason
 * their pickup equivalents are: a bought grenade or freeze lets a player win with their wallet.
 * Roster commands are never gated — the server needs them to seat and drop players.
 */
const VERSUS_BLOCKED_COMMANDS = new Set<Command['type']>(['grenade', 'clock', 'star']);

/** True when this command may run in this match. */
export function commandAllowed(state: GameState, type: Command['type']): boolean {
  return state.mode !== 'versus' || !VERSUS_BLOCKED_COMMANDS.has(type);
}

/** Server-authoritative commands (consumables, roster changes). */
export function applyCommand(state: GameState, cmd: Command): void {
  if (!commandAllowed(state, cmd.type)) return;
  const p = state.players[cmd.slot];
  switch (cmd.type) {
    case 'grenade':
      if (p) grenade(state, p.slot);
      break;
    case 'clock':
      state.effects.freezeUntil = state.tick + CLOCK_TICKS;
      state.events.push({ type: 'freeze' });
      break;
    case 'shield': {
      const t = p && playerTank(state, p);
      if (t) t.shieldUntil = Math.max(t.shieldUntil, state.tick + cmd.ticks);
      break;
    }
    case 'life':
      if (p) p.lives = Math.min(MAX_LIVES, p.lives + 1);
      break;
    case 'star':
      if (p) upgradePlayer(state, p, 1);
      break;
    case 'revive':
      if (p && p.active && p.lives <= 0) {
        p.lives = 1;
        if (state.status === 'gameOver' && state.gameOverReason === 'lives') {
          state.status = 'playing';
          state.gameOverReason = null;
          state.statusSince = state.tick;
        }
        if (!playerTank(state, p)) spawnPlayerTank(state, p);
      }
      break;
    case 'removePlayer':
      if (p) {
        p.active = false;
        const t = playerTank(state, p);
        if (t) state.tanks.splice(state.tanks.indexOf(t), 1);
        p.tankId = null;
      }
      break;
    case 'addPlayer': {
      const existing = state.players[cmd.slot];
      const slot = {
        slot: cmd.slot,
        id: cmd.id,
        name: cmd.name,
        active: true,
        tankId: null,
        lives: state.mode === 'versus' ? VERSUS_LIVES : STARTING_LIVES,
        score: 0,
        kills: 0,
        deaths: 0,
        tier: 0,
        respawnAt: 0,
        skin: cmd.skin,
        team: teamOf(cmd.slot, state.mode, state.versusFormat),
        usedItems: {},
      };
      if (existing) state.players[cmd.slot] = slot;
      else {
        while (state.players.length < cmd.slot) {
          const idx = state.players.length;
          state.players.push({ ...slot, slot: idx, active: false, id: '', name: '', team: teamOf(idx, state.mode, state.versusFormat) });
        }
        state.players.push(slot);
      }
      if (state.status === 'playing') spawnPlayerTank(state, state.players[cmd.slot]);
      break;
    }
  }
}
