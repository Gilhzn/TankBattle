import { CLOCK_TICKS, MAX_LIVES, STARTING_LIVES } from '../constants.js';
import type { Command, GameState } from '../types.js';
import { grenade } from './powerups.js';
import { playerTank, spawnPlayerTank, upgradePlayer } from './players.js';

/** Server-authoritative commands (consumables, roster changes). */
export function applyCommand(state: GameState, cmd: Command): void {
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
        lives: STARTING_LIVES,
        score: 0,
        kills: 0,
        deaths: 0,
        tier: 0,
        respawnAt: 0,
        skin: cmd.skin,
        usedItems: {},
      };
      if (existing) state.players[cmd.slot] = slot;
      else {
        while (state.players.length < cmd.slot) {
          state.players.push({ ...slot, slot: state.players.length, active: false, id: '', name: '' });
        }
        state.players.push(slot);
      }
      if (state.status === 'playing') spawnPlayerTank(state, state.players[cmd.slot]);
      break;
    }
  }
}
