import { describe, expect, it } from 'vitest';
import { STAGES, VERSUS_ARENA } from '../maps/stages.js';
import { parseCells } from '../maps/format.js';
import { generateStage, expandRoster, getStageDef } from '../maps/generator.js';
import { Tile } from '../types.js';
import { baseRingTiles, baseTiles, getTile } from '../grid.js';
import { ENEMY_SPAWN_TILES, PLAYER_SPAWN_TILES, GRID, ENEMIES_PER_STAGE } from '../constants.js';

describe('maps', () => {
  it('all authored stages parse to 26x26 with base ring and clear spawns', () => {
    for (const s of STAGES) {
      const tiles = parseCells(s.cells);
      expect(tiles.length).toBe(GRID * GRID);
      for (const [tx, ty] of baseTiles()) expect(getTile(tiles, tx, ty)).toBe(Tile.BASE);
      for (const [tx, ty] of baseRingTiles()) expect(getTile(tiles, tx, ty)).toBe(Tile.BRICK);
      for (const tx of ENEMY_SPAWN_TILES) for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) expect(getTile(tiles, tx + dx, dy)).toBe(Tile.EMPTY);
      for (const tx of PLAYER_SPAWN_TILES) for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) expect(getTile(tiles, tx + dx, GRID - 2 + dy)).toBe(Tile.EMPTY);
      expect(s.roster.reduce((n, [, c]) => n + c, 0)).toBe(ENEMIES_PER_STAGE);
    }
  });
  it('versus arena has no base', () => {
    const tiles = parseCells(VERSUS_ARENA.cells, false);
    for (const [tx, ty] of baseTiles()) expect(getTile(tiles, tx, ty)).toBe(Tile.EMPTY);
  });
  it('generated stages are deterministic and valid', () => {
    const a = generateStage(20);
    const b = generateStage(20);
    expect(a.cells).toEqual(b.cells);
    expect(() => parseCells(a.cells)).not.toThrow();
    expect(expandRoster(a.roster).length).toBe(ENEMIES_PER_STAGE);
    expect(getStageDef(1).name).toBe(STAGES[0].name);
    expect(getStageDef(50).name).toContain('50');
  });
  it('rejects malformed maps', () => {
    expect(() => parseCells(['...'])).toThrow();
    expect(() => parseCells(Array(13).fill('?????????????'))).toThrow();
  });
});
