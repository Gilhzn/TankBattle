import { describe, expect, it } from 'vitest';
import { makeState, run, p0Tank, clearEnemies, UP, FIRE, NONE, fillTiles } from './helpers.js';
import { Tile, type Tank } from '../types.js';
import { TILE, TANK_SIZE, BULLET_SPEED_SLOW, BULLET_SPEED_FAST } from '../constants.js';
import { getTile, tileIndex } from '../grid.js';
import { tryFire } from '../sim/bullets.js';
import { step } from '../sim/step.js';

function enemyAt(s: ReturnType<typeof makeState>, x: number, y: number, kind: Tank['kind'] = 'basic', hp = 1): Tank {
  const t: Tank = {
    id: s.nextId++, owner: -1, kind, x, y, dir: 2, tier: 0, hp, maxHp: hp, speed: 0, moving: false, shieldUntil: 0, spawnUntil: 0,
    ship: false, flashing: false, bullets: 0, cooldown: 1e6, slide: 0, ai: { timer: 9999, blocked: 0 }, skin: 'enemy',
  };
  s.tanks.push(t);
  return t;
}

describe('bullets', () => {
  it('tier 0 fires one slow bullet, tier 2 fires two fast ones', () => {
    const s = makeState();
    clearEnemies(s);
    fillTiles(s, (tx, ty) => (ty < 24 ? Tile.EMPTY : undefined));
    run(s, 1, [FIRE]);
    expect(s.bullets.length).toBe(1);
    expect(s.bullets[0].speed).toBe(BULLET_SPEED_SLOW);
    run(s, 1, [FIRE]);
    expect(s.bullets.length).toBe(1);
    s.players[0].tier = 2;
    p0Tank(s).tier = 2;
    run(s, 1, [FIRE]);
    run(s, 7, [FIRE]);
    expect(s.bullets.length).toBe(2);
    expect(s.bullets[1].speed).toBe(BULLET_SPEED_FAST);
  });
  it('destroys a 2-wide brick swath, 1 deep for tier 0 and 2 deep + steel for tier 3', () => {
    for (const tier of [0, 3]) {
      const s = makeState();
      clearEnemies(s);
      fillTiles(s, (tx, ty) => (ty < 24 ? Tile.EMPTY : undefined));
      const t = p0Tank(s);
      t.tier = tier;
      const tx = Math.floor(t.x / TILE);
      const ty = 15;
      for (let dy = 0; dy < 3; dy++) for (let dx = -1; dx < 4; dx++) s.tiles[tileIndex(tx + dx, ty + dy)] = dy === 1 ? Tile.STEEL : Tile.BRICK;
      run(s, 1, [FIRE]);
      run(s, 40, [NONE]);
      expect(s.bullets.length).toBe(0);
      // front row: the two tiles in front of the tank destroyed, the outer ones intact
      expect(getTile(s.tiles, tx, ty + 2)).toBe(Tile.EMPTY);
      expect(getTile(s.tiles, tx + 1, ty + 2)).toBe(Tile.EMPTY);
      expect(getTile(s.tiles, tx - 1, ty + 2)).toBe(Tile.BRICK);
      expect(getTile(s.tiles, tx + 2, ty + 2)).toBe(Tile.BRICK);
      // second row is steel: only tier 3 removes it
      expect(getTile(s.tiles, tx, ty + 1)).toBe(tier === 3 ? Tile.EMPTY : Tile.STEEL);
    }
  });
  it('steel stops tier 0 bullets without damage', () => {
    const s = makeState();
    clearEnemies(s);
    fillTiles(s, (tx, ty) => (ty < 24 ? Tile.EMPTY : undefined));
    const t = p0Tank(s);
    const tx = Math.floor(t.x / TILE);
    s.tiles[tileIndex(tx, 20)] = Tile.STEEL;
    s.tiles[tileIndex(tx + 1, 20)] = Tile.STEEL;
    run(s, 1, [FIRE]);
    run(s, 20, [NONE]);
    expect(getTile(s.tiles, tx, 20)).toBe(Tile.STEEL);
    expect(s.bullets.length).toBe(0);
  });
  it('kills a basic enemy and scores; armor takes 4 hits', () => {
    const s = makeState();
    clearEnemies(s);
    fillTiles(s, (tx, ty) => (ty < 24 ? Tile.EMPTY : undefined));
    const t = p0Tank(s);
    enemyAt(s, t.x, t.y - 6 * TILE);
    run(s, 1, [FIRE]);
    run(s, 20, [NONE]);
    expect(s.tanks.filter((x) => x.kind !== 'player').length).toBe(0);
    expect(s.players[0].score).toBe(100);
    expect(s.players[0].kills).toBe(1);
    expect(s.enemies.killed).toBe(1);

    const armor = enemyAt(s, t.x, t.y - 6 * TILE, 'armor', 4);
    for (let i = 0; i < 3; i++) {
      run(s, 1, [FIRE]);
      run(s, 20, [NONE]);
    }
    expect(armor.hp).toBe(1);
    expect(s.tanks.includes(armor)).toBe(true);
    run(s, 1, [FIRE]);
    run(s, 20, [NONE]);
    expect(s.tanks.includes(armor)).toBe(false);
    expect(s.players[0].score).toBe(500);
  });
  it('enemy bullet kills an unshielded player and is absorbed by a shield', () => {
    const s = makeState();
    clearEnemies(s);
    fillTiles(s, (tx, ty) => (ty < 24 ? Tile.EMPTY : undefined));
    const t = p0Tank(s);
    const e = enemyAt(s, t.x, t.y - 6 * TILE);
    e.dir = 2;
    // shield active from spawn
    tryFire(s, e);
    run(s, 20, [NONE]);
    expect(s.players[0].lives).toBe(3);
    t.shieldUntil = 0;
    e.bullets = 0;
    e.cooldown = 0;
    tryFire(s, e);
    run(s, 20, [NONE]);
    expect(s.players[0].lives).toBe(2);
    expect(s.players[0].tankId).toBeNull();
  });
  it('co-op friendly bullets pass through allies; versus bullets kill', () => {
    for (const mode of ['coop', 'versus'] as const) {
      const s = makeState(3, 1, [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], mode);
      clearEnemies(s);
      fillTiles(s, () => Tile.EMPTY);
      const a = p0Tank(s);
      const b = s.tanks.find((t) => t.owner === 1)!;
      b.x = a.x;
      b.y = a.y - 5 * TILE;
      b.shieldUntil = 0;
      a.shieldUntil = 0;
      run(s, 1, [FIRE, NONE]);
      run(s, 20, [NONE, NONE]);
      const bAlive = s.tanks.some((t) => t.owner === 1);
      expect(bAlive).toBe(mode === 'coop');
      if (mode === 'versus') expect(s.players[0].kills).toBe(1);
    }
  });
  it('opposing bullets cancel each other', () => {
    const s = makeState();
    clearEnemies(s);
    fillTiles(s, (tx, ty) => (ty < 24 ? Tile.EMPTY : undefined));
    const t = p0Tank(s);
    const e = enemyAt(s, t.x, t.y - 8 * TILE, 'power');
    e.dir = 2;
    e.cooldown = 0;
    tryFire(s, e);
    run(s, 1, [FIRE]);
    expect(s.bullets.length).toBe(2);
    run(s, 12, [NONE]);
    expect(s.bullets.length).toBe(0);
    expect(s.tanks.length).toBe(2);
  });
  it('a shot at the base destroys it and ends the game', () => {
    const s = makeState();
    clearEnemies(s);
    const t = p0Tank(s);
    // put the tank right above the base ring, facing down, and remove the ring brick in front
    t.x = 12 * TILE;
    t.y = 21 * TILE;
    t.dir = 2;
    s.tiles[tileIndex(12, 23)] = Tile.EMPTY;
    s.tiles[tileIndex(13, 23)] = Tile.EMPTY;
    tryFire(s, t);
    for (let i = 0; i < 10; i++) step(s, [NONE]);
    expect(s.baseAlive).toBe(false);
    expect(s.status).toBe('gameOver');
    expect(s.gameOverReason).toBe('base');
    expect(getTile(s.tiles, 12, 24)).toBe(Tile.BASE_DEAD);
  });
  it('spawning enemies are invulnerable', () => {
    const s = makeState();
    clearEnemies(s);
    fillTiles(s, (tx, ty) => (ty < 24 ? Tile.EMPTY : undefined));
    const t = p0Tank(s);
    const e = enemyAt(s, t.x, t.y - 6 * TILE);
    e.spawnUntil = s.tick + 1000;
    run(s, 1, [FIRE]);
    run(s, 20, [NONE]);
    expect(s.tanks.includes(e)).toBe(true);
    expect(s.bullets.length).toBe(0);
    void UP;
    void TANK_SIZE;
  });
});
