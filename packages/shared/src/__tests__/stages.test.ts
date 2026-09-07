import { describe, expect, it } from 'vitest';
import { STAGES } from '../maps/stages.js';
import { parseCells } from '../maps/format.js';
import { BASE_TILE_X, BASE_TILE_Y, ENEMY_SPAWN_TILES, GRID, PLAYER_SPAWN_TILES, TANK_SIZE, TILE } from '../constants.js';
import { getTile } from '../grid.js';
import { Tile } from '../types.js';

/** Tiles a tank can never drive through, however much it shoots. Brick and trees are not here. */
const PERMANENT = new Set<number>([Tile.STEEL, Tile.WATER]);

const SPAN = TANK_SIZE / TILE; // tiles covered by a tank on each axis

function fits(tiles: Uint8Array, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx + SPAN > GRID || ty + SPAN > GRID) return false;
  for (let y = ty; y < ty + SPAN; y++) {
    for (let x = tx; x < tx + SPAN; x++) if (PERMANENT.has(getTile(tiles, x, y))) return false;
  }
  return true;
}

/**
 * Flood fill over tank-sized placements, treating brick as passable (it can be shot away) and
 * steel/water as permanent walls. Returns the reachable top-left tile coordinates.
 */
function reachable(tiles: Uint8Array, sx: number, sy: number): Set<number> {
  const seen = new Set<number>();
  if (!fits(tiles, sx, sy)) return seen;
  const queue: Array<[number, number]> = [[sx, sy]];
  seen.add(sy * GRID + sx);
  while (queue.length) {
    const [x, y] = queue.pop()!;
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      const key = ny * GRID + nx;
      if (seen.has(key) || !fits(tiles, nx, ny)) continue;
      seen.add(key);
      queue.push([nx, ny]);
    }
  }
  return seen;
}

describe('stages', () => {
  it('are all 13x13 cells', () => {
    for (const s of STAGES) {
      expect(s.cells, s.name).toHaveLength(13);
      for (const row of s.cells) expect(row, `${s.name}: "${row}"`).toHaveLength(13);
    }
  });

  it('let every spawn reach the base past the permanent terrain', () => {
    // Water and steel never break. A stage that seals the base behind them is unwinnable for the
    // AI and a dead end for the player, and neither shows up in a normal playtest of stage 1.
    const approach = (BASE_TILE_Y - SPAN) * GRID + BASE_TILE_X;
    const spawns: Array<[number, number]> = [
      ...ENEMY_SPAWN_TILES.map((tx) => [tx, 0] as [number, number]),
      ...PLAYER_SPAWN_TILES.map((tx) => [tx, GRID - SPAN] as [number, number]),
    ];
    for (const stage of STAGES) {
      const tiles = parseCells(stage.cells, true);
      for (const [sx, sy] of spawns) {
        const set = reachable(tiles, sx, sy);
        expect(set.size, `${stage.name}: spawn ${sx},${sy} is walled in`).toBeGreaterThan(40);
        expect(set.has(approach), `${stage.name}: base unreachable from spawn ${sx},${sy}`).toBe(true);
      }
    }
  });

  it('gives the opening stage some terrain to teach, not just brick', () => {
    // Stage 1 is the first impression: it used to be the only stage with no water and no trees.
    const first = STAGES[0].cells.join('');
    expect(first).toContain('~');
    expect(first).toContain('%');
  });
});
