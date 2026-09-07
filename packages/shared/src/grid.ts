import { GRID, TILE, FIELD, BASE_TILE_X, BASE_TILE_Y } from './constants.js';
import { Tile, type TileId, type GameState } from './types.js';

export const tileIndex = (tx: number, ty: number): number => ty * GRID + tx;
export const inBounds = (tx: number, ty: number): boolean => tx >= 0 && ty >= 0 && tx < GRID && ty < GRID;

export function getTile(tiles: Uint8Array, tx: number, ty: number): TileId {
  if (!inBounds(tx, ty)) return Tile.STEEL;
  return tiles[tileIndex(tx, ty)] as TileId;
}

export function setTile(state: GameState, tx: number, ty: number, t: TileId): void {
  if (!inBounds(tx, ty)) return;
  const i = tileIndex(tx, ty);
  if (state.tiles[i] === t) return;
  state.tiles[i] = t;
  state.tileChanges.push(i);
}

export const isSolidForTank = (t: TileId, ship: boolean): boolean =>
  t === Tile.BRICK || t === Tile.STEEL || t === Tile.BASE || t === Tile.BASE_DEAD || (t === Tile.WATER && !ship);

export const isSolidForBullet = (t: TileId): boolean =>
  t === Tile.BRICK || t === Tile.STEEL || t === Tile.BASE;

/** Tile range covered by a sub-pixel rect. */
export function tileSpan(x: number, y: number, w: number, h: number): { x0: number; y0: number; x1: number; y1: number } {
  return {
    x0: Math.floor(x / TILE),
    y0: Math.floor(y / TILE),
    x1: Math.floor((x + w - 1) / TILE),
    y1: Math.floor((y + h - 1) / TILE),
  };
}

export function rectHitsSolidTile(tiles: Uint8Array, x: number, y: number, w: number, h: number, ship: boolean): boolean {
  if (x < 0 || y < 0 || x + w > FIELD || y + h > FIELD) return true;
  const s = tileSpan(x, y, w, h);
  for (let ty = s.y0; ty <= s.y1; ty++) {
    for (let tx = s.x0; tx <= s.x1; tx++) {
      if (isSolidForTank(getTile(tiles, tx, ty), ship)) return true;
    }
  }
  return false;
}

export function rectsOverlap(ax: number, ay: number, aw: number, ah: number, bx: number, by: number, bw: number, bh: number): boolean {
  return ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah;
}

/** Tiles forming the brick ring around the base (the shovel affects these). */
export function baseRingTiles(): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let ty = BASE_TILE_Y - 1; ty <= BASE_TILE_Y + 1; ty++) {
    for (let tx = BASE_TILE_X - 1; tx <= BASE_TILE_X + 2; tx++) {
      const isBase = tx >= BASE_TILE_X && tx <= BASE_TILE_X + 1 && ty >= BASE_TILE_Y;
      if (!isBase && inBounds(tx, ty)) out.push([tx, ty]);
    }
  }
  return out;
}

export function baseTiles(): Array<[number, number]> {
  return [
    [BASE_TILE_X, BASE_TILE_Y],
    [BASE_TILE_X + 1, BASE_TILE_Y],
    [BASE_TILE_X, BASE_TILE_Y + 1],
    [BASE_TILE_X + 1, BASE_TILE_Y + 1],
  ];
}

export function encodeTiles(tiles: Uint8Array): string {
  let s = '';
  for (let i = 0; i < tiles.length; i++) s += String.fromCharCode(48 + tiles[i]);
  return s;
}

export function decodeTiles(s: string): Uint8Array {
  const out = new Uint8Array(GRID * GRID);
  for (let i = 0; i < out.length && i < s.length; i++) out[i] = s.charCodeAt(i) - 48;
  return out;
}
