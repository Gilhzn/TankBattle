import { describe, expect, it } from 'vitest';
import { makeState, run, NONE, p0Tank, clearEnemies } from './helpers.js';
import { killPlayerTank, playerTank } from '../sim/players.js';
import { RESPAWN_DELAY_TICKS, RESPAWN_SHIELD_TICKS } from '../constants.js';
import { step } from '../sim/step.js';

describe('players', () => {
  it('respawns with a shield and tier reset after death while lives remain', () => {
    const s = makeState(31);
    clearEnemies(s);
    s.players[0].tier = 2;
    p0Tank(s).tier = 2;
    killPlayerTank(s, p0Tank(s), -1);
    expect(s.players[0].lives).toBe(2);
    expect(s.players[0].tier).toBe(0);
    expect(playerTank(s, s.players[0])).toBeUndefined();
    run(s, RESPAWN_DELAY_TICKS - 1, [NONE]);
    expect(playerTank(s, s.players[0])).toBeUndefined();
    run(s, 2, [NONE]);
    const t = p0Tank(s);
    expect(t.shieldUntil - s.tick).toBeGreaterThanOrEqual(RESPAWN_SHIELD_TICKS - 2);
  });
  it('game over when every player is out of lives', () => {
    const s = makeState(33, 1, [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
    clearEnemies(s);
    for (let i = 0; i < 3; i++) {
      for (const p of s.players) {
        const t = playerTank(s, p);
        if (t) killPlayerTank(s, t, -1);
      }
      run(s, RESPAWN_DELAY_TICKS + 2, [NONE, NONE]);
    }
    expect(s.players.every((p) => p.lives === 0)).toBe(true);
    expect(s.status).toBe('gameOver');
    expect(s.gameOverReason).toBe('lives');
  });
  it('versus mode: unlimited respawns, kills scored, timer ends the match', () => {
    const s = makeState(35, 1, [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], 'versus');
    expect(s.tanks.length).toBe(2);
    expect(s.baseAlive).toBe(false);
    killPlayerTank(s, p0Tank(s), 1);
    expect(s.players[1].kills).toBe(1);
    run(s, RESPAWN_DELAY_TICKS + 2, [NONE, NONE]);
    expect(p0Tank(s)).toBeTruthy();
    s.timeLeft = 3;
    for (let i = 0; i < 5; i++) step(s, [NONE, NONE]);
    expect(s.status).toBe('gameOver');
    expect(s.gameOverReason).toBe('time');
  });
  it('commands: grenade, clock, shield, life, star, revive, removePlayer, addPlayer', () => {
    const s = makeState(37);
    run(s, 40, [NONE]);
    expect(s.tanks.some((t) => t.kind !== 'player')).toBe(true);
    step(s, [NONE], [{ type: 'grenade', slot: 0 }]);
    expect(s.tanks.some((t) => t.kind !== 'player')).toBe(false);
    step(s, [NONE], [{ type: 'clock', slot: 0 }, { type: 'shield', slot: 0, ticks: 500 }, { type: 'life', slot: 0 }, { type: 'star', slot: 0 }]);
    expect(s.effects.freezeUntil).toBeGreaterThan(s.tick);
    expect(p0Tank(s).shieldUntil).toBe(s.tick + 500);
    expect(s.players[0].lives).toBe(4);
    expect(s.players[0].tier).toBe(1);
    step(s, [NONE], [{ type: 'addPlayer', slot: 1, id: 'b', name: 'B', skin: 'p2' }]);
    expect(s.players[1].active).toBe(true);
    expect(s.tanks.filter((t) => t.kind === 'player').length).toBe(2);
    step(s, [NONE, NONE], [{ type: 'removePlayer', slot: 1 }]);
    expect(s.players[1].active).toBe(false);
    expect(s.tanks.filter((t) => t.kind === 'player').length).toBe(1);
    // revive after losing everything
    clearEnemies(s);
    s.players[0].lives = 1;
    killPlayerTank(s, p0Tank(s), -1);
    run(s, 2, [NONE]);
    expect(s.status).toBe('gameOver');
    step(s, [NONE], [{ type: 'revive', slot: 0 }]);
    expect(s.status).toBe('playing');
    expect(p0Tank(s)).toBeTruthy();
  });
});
