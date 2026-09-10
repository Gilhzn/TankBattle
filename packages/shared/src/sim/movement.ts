import { DIRS, FIELD, TANK_SIZE, TILE } from '../constants.js';
import { getTile, rectHitsSolidTile, rectsOverlap } from '../grid.js';
import { Tile, type Dir } from '../types.js';

/** Anything with a position that a tank can bump into. */
export interface Body {
  x: number;
  y: number;
}

/**
 * The part of the world moving a tank depends on: what it can drive through, and what is in the way.
 *
 * A `GameState` satisfies this, and so does the client's view of a match — which is what lets the
 * client predict its own tank with the very same code the server runs, instead of an approximation
 * that would disagree with it.
 */
export interface MoveWorld {
  tiles: Uint8Array;
  tanks: readonly Body[];
}

/** A tank as movement sees it. */
export interface Movable extends Body {
  dir: Dir;
  ship: boolean;
}

export function tankOverlapsOthers(state: MoveWorld, tank: Body | null, x: number, y: number): boolean {
  for (const o of state.tanks) {
    if (o === tank) continue;
    if (rectsOverlap(x, y, TANK_SIZE, TANK_SIZE, o.x, o.y, TANK_SIZE, TANK_SIZE)) return true;
  }
  return false;
}

export function positionFree(state: MoveWorld, tank: Body | null, x: number, y: number, ship: boolean): boolean {
  if (rectHitsSolidTile(state.tiles, x, y, TANK_SIZE, TANK_SIZE, ship)) return false;
  return !tankOverlapsOthers(state, tank, x, y);
}

/**
 * Snap to the 8px lane grid on the perpendicular axis when turning. Without it a tank that is a
 * pixel off a lane wedges on the corner of the gap it is aiming at, which reads as the controls
 * ignoring you.
 */
function snapLane(state: MoveWorld, tank: Movable, dir: Dir): void {
  const vertical = dir === 0 || dir === 2;
  const snapped = Math.round((vertical ? tank.x : tank.y) / TILE) * TILE;
  const nx = vertical ? snapped : tank.x;
  const ny = vertical ? tank.y : snapped;
  if (nx === tank.x && ny === tank.y) return;
  if (positionFree(state, tank, nx, ny, tank.ship)) {
    tank.x = nx;
    tank.y = ny;
  }
}

/** Moves the tank up to `dist` sub-pixels along `dir`; returns the distance actually moved. */
export function moveTank(state: MoveWorld, tank: Movable, dir: Dir, dist: number): number {
  const prevDir = tank.dir;
  tank.dir = dir;
  const axisChanged = (prevDir === 0 || prevDir === 2) !== (dir === 0 || dir === 2);
  if (axisChanged) snapLane(state, tank, dir);
  const [dx, dy] = DIRS[dir];
  for (let d = dist; d > 0; d--) {
    const nx = tank.x + dx * d;
    const ny = tank.y + dy * d;
    if (nx < 0 || ny < 0 || nx + TANK_SIZE > FIELD || ny + TANK_SIZE > FIELD) continue;
    if (positionFree(state, tank, nx, ny, tank.ship)) {
      tank.x = nx;
      tank.y = ny;
      return d;
    }
  }
  return 0;
}

export function tankOnIce(state: MoveWorld, tank: Body): boolean {
  const cx = Math.floor((tank.x + TANK_SIZE / 2) / TILE);
  const cy = Math.floor((tank.y + TANK_SIZE / 2) / TILE);
  return getTile(state.tiles, cx, cy) === Tile.ICE;
}
