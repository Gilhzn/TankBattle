import { describe, expect, it } from 'vitest';
import { makeState, run, p0Tank, clearEnemies, UP, DOWN, LEFT, RIGHT, NONE, fillTiles } from './helpers.js';
import { Tile } from '../types.js';
import { TILE, TANK_SIZE, FIELD, PLAYER_SPEED, ICE_SLIDE_TICKS } from '../constants.js';
import { tileIndex } from '../grid.js';

describe('movement', () => {
  it('moves up at player speed on open ground', () => {
    const s = makeState();
    clearEnemies(s);
    const t = p0Tank(s);
    const y0 = t.y;
    run(s, 5, [UP]);
    expect(p0Tank(s).y).toBe(y0 - 5 * PLAYER_SPEED);
  });
  it('is blocked by brick, steel and water; ship crosses water', () => {
    for (const tile of [Tile.BRICK, Tile.STEEL, Tile.WATER]) {
      const s = makeState();
      clearEnemies(s);
      const t = p0Tank(s);
      const tx = Math.floor(t.x / TILE);
      const ty = Math.floor(t.y / TILE) - 1;
      s.tiles[tileIndex(tx, ty)] = tile;
      s.tiles[tileIndex(tx + 1, ty)] = tile;
      const y0 = t.y;
      run(s, 10, [UP]);
      expect(p0Tank(s).y).toBe(y0);
      if (tile === Tile.WATER) {
        p0Tank(s).ship = true;
        run(s, 3, [UP]);
        expect(p0Tank(s).y).toBeLessThan(y0);
      }
    }
  });
  it('clamps to field bounds', () => {
    const s = makeState();
    clearEnemies(s);
    run(s, 200, [DOWN]);
    expect(p0Tank(s).y).toBe(FIELD - TANK_SIZE);
    run(s, 400, [LEFT]);
    expect(p0Tank(s).x).toBe(0);
  });
  it('snaps to the lane grid when turning', () => {
    const s = makeState();
    clearEnemies(s);
    fillTiles(s, (tx, ty) => (ty < 20 ? Tile.EMPTY : undefined));
    run(s, 3, [UP]); // y now off-grid: 3*16 = 48 sub
    const t = p0Tank(s);
    expect(t.y % TILE).not.toBe(0);
    run(s, 1, [RIGHT]);
    expect(p0Tank(s).y % TILE).toBe(0);
  });
  it('tanks block each other', () => {
    const s = makeState(1, 1, [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
    clearEnemies(s);
    const a = p0Tank(s);
    const b = s.tanks.find((t) => t.owner === 1)!;
    b.x = a.x + TANK_SIZE + 8; // just to the right
    b.y = a.y;
    run(s, 5, [RIGHT, NONE]);
    expect(p0Tank(s).x).toBe(b.x - TANK_SIZE);
  });
  it('slides on ice after releasing input, then stops', () => {
    const s = makeState();
    clearEnemies(s);
    fillTiles(s, (tx, ty) => (ty < 24 ? Tile.ICE : undefined));
    run(s, 5, [UP]);
    const yAfterMove = p0Tank(s).y;
    run(s, 1, [NONE]);
    expect(p0Tank(s).slide).toBe(ICE_SLIDE_TICKS);
    run(s, ICE_SLIDE_TICKS, [NONE]);
    const ySlid = p0Tank(s).y;
    expect(ySlid).toBeLessThan(yAfterMove);
    expect(p0Tank(s).slide).toBe(0);
    run(s, 5, [NONE]);
    expect(p0Tank(s).y).toBe(ySlid);
  });
  it('does not slide on plain ground', () => {
    const s = makeState();
    clearEnemies(s);
    fillTiles(s, (tx, ty) => (ty < 24 ? Tile.EMPTY : undefined));
    run(s, 5, [UP]);
    const y = p0Tank(s).y;
    run(s, 5, [NONE]);
    expect(p0Tank(s).y).toBe(y);
  });
});
