import { GRID, ENEMY_SPAWN_TILES, PLAYER_SPAWN_TILES, VERSUS_SPAWN_TILES, BASE_TILE_X, BASE_TILE_Y } from '../constants.js';
import { Tile, type TileId } from '../types.js';
import { baseRingTiles, baseTiles, tileIndex } from '../grid.js';

const CELL_CHARS: Record<string, TileId> = {
  '.': Tile.EMPTY,
  '#': Tile.BRICK,
  '@': Tile.STEEL,
  '%': Tile.TREES,
  '~': Tile.WATER,
  '=': Tile.ICE,
};

/**
 * Parses a 13x13 "cell" map (each cell = 2x2 tiles) into a 26x26 tile grid.
 * Enemy spawn cells, player spawn cells and the base + brick ring are always enforced.
 */
export function parseCells(cells: string[], withBase = true): Uint8Array {
  if (cells.length !== 13) throw new Error(`map must have 13 rows, got ${cells.length}`);
  const tiles = new Uint8Array(GRID * GRID);
  for (let cy = 0; cy < 13; cy++) {
    const row = cells[cy];
    if (row.length !== 13) throw new Error(`row ${cy} must have 13 cells, got ${row.length}`);
    for (let cx = 0; cx < 13; cx++) {
      const t = CELL_CHARS[row[cx]];
      if (t === undefined) throw new Error(`unknown cell char '${row[cx]}' at ${cx},${cy}`);
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) tiles[tileIndex(cx * 2 + dx, cy * 2 + dy)] = t;
    }
  }
  clearArea(tiles, ENEMY_SPAWN_TILES, 0);
  clearArea(tiles, PLAYER_SPAWN_TILES, GRID - 2);
  if (withBase) {
    for (const [tx, ty] of baseRingTiles()) tiles[tileIndex(tx, ty)] = Tile.BRICK;
    for (const [tx, ty] of baseTiles()) tiles[tileIndex(tx, ty)] = Tile.BASE;
  } else {
    for (const [tx, ty] of baseRingTiles()) tiles[tileIndex(tx, ty)] = Tile.EMPTY;
    for (const [tx, ty] of baseTiles()) tiles[tileIndex(tx, ty)] = Tile.EMPTY;
    // Versus seats the players in the four corners instead of along the bottom, so those are the
    // squares that must be guaranteed clear.
    for (const [tx, ty] of VERSUS_SPAWN_TILES) {
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) tiles[tileIndex(tx + dx, ty + dy)] = Tile.EMPTY;
    }
  }
  // keep the bottom lane between the player spawns walkable (the base ring is the only obstacle there)
  for (let tx = PLAYER_SPAWN_TILES[2]; tx < PLAYER_SPAWN_TILES[3] + 2; tx++) {
    for (let ty = GRID - 2; ty < GRID; ty++) {
      const ring = tx >= BASE_TILE_X - 1 && tx <= BASE_TILE_X + 2 && ty >= BASE_TILE_Y - 1;
      if (!ring) tiles[tileIndex(tx, ty)] = Tile.EMPTY;
    }
  }
  return tiles;
}

function clearArea(tiles: Uint8Array, xs: number[], ty: number): void {
  for (const tx of xs) {
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) tiles[tileIndex(tx + dx, ty + dy)] = Tile.EMPTY;
  }
}

export function tilesToAscii(tiles: Uint8Array): string {
  const chars = '.#@%~=EX';
  let s = '';
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) s += chars[tiles[tileIndex(x, y)]];
    s += '\n';
  }
  return s;
}
