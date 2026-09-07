import { describe, expect, it } from 'vitest';
import { makeState, run, NONE, p0Tank, clearEnemies, fillTiles } from './helpers.js';
import { Tile, type PowerUpKind, type Tank } from '../types.js';
import { CLOCK_TICKS, HELMET_TICKS, SHOVEL_TICKS, TILE, SHOVEL_FLASH_TICKS } from '../constants.js';
import { baseRingTiles, getTile } from '../grid.js';

function give(s: ReturnType<typeof makeState>, kind: PowerUpKind, tank: Tank) {
  s.powerUp = { kind, x: tank.x, y: tank.y, spawnedTick: s.tick };
}

describe('power-ups', () => {
  const setup = () => {
    const s = makeState(21);
    clearEnemies(s);
    fillTiles(s, (tx, ty) => (ty < 22 ? Tile.EMPTY : undefined));
    return s;
  };
  it('star upgrades tier up to 3, gun maxes instantly', () => {
    const s = setup();
    for (let i = 0; i < 5; i++) {
      give(s, 'star', p0Tank(s));
      run(s, 1, [NONE]);
    }
    expect(s.players[0].tier).toBe(3);
    expect(p0Tank(s).tier).toBe(3);
    s.players[0].tier = 0;
    p0Tank(s).tier = 0;
    give(s, 'gun', p0Tank(s));
    run(s, 1, [NONE]);
    expect(p0Tank(s).tier).toBe(3);
    expect(s.players[0].score).toBe(500 * 6);
  });
  it('tank grants a life, helmet a shield, ship water crossing, clock freezes', () => {
    const s = setup();
    give(s, 'tank', p0Tank(s));
    run(s, 1, [NONE]);
    expect(s.players[0].lives).toBe(4);
    give(s, 'helmet', p0Tank(s));
    run(s, 1, [NONE]);
    expect(p0Tank(s).shieldUntil).toBe(s.tick + HELMET_TICKS);
    give(s, 'ship', p0Tank(s));
    run(s, 1, [NONE]);
    expect(p0Tank(s).ship).toBe(true);
    give(s, 'clock', p0Tank(s));
    run(s, 1, [NONE]);
    expect(s.effects.freezeUntil).toBe(s.tick + CLOCK_TICKS);
  });
  it('grenade kills every enemy on screen without score', () => {
    const s = makeState(23);
    run(s, 40, [NONE]);
    expect(s.tanks.some((t) => t.kind !== 'player')).toBe(true);
    const score = s.players[0].score;
    give(s, 'grenade', p0Tank(s));
    run(s, 1, [NONE]);
    expect(s.tanks.some((t) => t.kind !== 'player')).toBe(false);
    expect(s.players[0].score).toBe(score + 500);
  });
  it('shovel turns the base ring to steel, flashes, then restores brick', () => {
    const s = setup();
    give(s, 'shovel', p0Tank(s));
    run(s, 1, [NONE]);
    for (const [tx, ty] of baseRingTiles()) expect(getTile(s.tiles, tx, ty)).toBe(Tile.STEEL);
    run(s, SHOVEL_TICKS - SHOVEL_FLASH_TICKS - 5, [NONE]);
    for (const [tx, ty] of baseRingTiles()) expect(getTile(s.tiles, tx, ty)).toBe(Tile.STEEL);
    let sawBrick = false;
    for (let i = 0; i < SHOVEL_FLASH_TICKS; i++) {
      run(s, 1, [NONE]);
      if (getTile(s.tiles, 11, 23) === Tile.BRICK) sawBrick = true;
    }
    expect(sawBrick).toBe(true);
    run(s, 10, [NONE]);
    for (const [tx, ty] of baseRingTiles()) expect(getTile(s.tiles, tx, ty)).toBe(Tile.BRICK);
    expect(s.effects.shovelUntil).toBe(0);
  });
  it('enemy picking up shovel strips the base ring; picking up clock freezes players', () => {
    const s = setup();
    const e: Tank = { ...p0Tank(s), id: 999, owner: -1, kind: 'basic', x: 4 * TILE, y: 4 * TILE, ai: { timer: 9999, blocked: 0 }, speed: 0, shieldUntil: 0 };
    s.tanks.push(e);
    give(s, 'shovel', e);
    run(s, 1, [NONE]);
    for (const [tx, ty] of baseRingTiles()) expect(getTile(s.tiles, tx, ty)).toBe(Tile.EMPTY);
    give(s, 'clock', e);
    run(s, 1, [NONE]);
    expect(s.effects.playerFreezeUntil).toBeGreaterThan(s.tick);
    const y = p0Tank(s).y;
    run(s, 5, [{ dir: 0, fire: false }]);
    expect(p0Tank(s).y).toBe(y);
  });
  it('power-ups expire', () => {
    const s = setup();
    s.powerUp = { kind: 'star', x: 0, y: 0, spawnedTick: s.tick };
    run(s, 30 * 30 + 2, [NONE]);
    expect(s.powerUp).toBeNull();
  });
});
