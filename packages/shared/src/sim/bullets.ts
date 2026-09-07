import {
  BULLET_SIZE, BULLET_SPEED_FAST, BULLET_SPEED_SLOW, DIRS, ENEMY_SCORE, FIELD, FIRE_COOLDOWN_TICKS, TANK_SIZE, TILE,
} from '../constants.js';
import { getTile, isSolidForBullet, rectsOverlap, setTile, tileSpan } from '../grid.js';
import { Tile, type Bullet, type GameState, type Tank } from '../types.js';
import { dropPowerUp } from './powerups.js';
import { killPlayerTank } from './players.js';

export function maxBulletsFor(tank: Tank): number {
  if (tank.kind !== 'player') return 1;
  return tank.tier >= 2 ? 2 : 1;
}

export function bulletSpeedFor(tank: Tank): number {
  if (tank.kind === 'player') return tank.tier >= 1 ? BULLET_SPEED_FAST : BULLET_SPEED_SLOW;
  if (tank.kind === 'power') return BULLET_SPEED_FAST;
  return tank.tier >= 1 ? BULLET_SPEED_FAST : BULLET_SPEED_SLOW;
}

export function tryFire(state: GameState, tank: Tank): boolean {
  if (tank.cooldown > 0 || tank.bullets >= maxBulletsFor(tank)) return false;
  if (tank.spawnUntil > state.tick) return false;
  const [dx, dy] = DIRS[tank.dir];
  const cx = tank.x + TANK_SIZE / 2 + dx * (TANK_SIZE / 2);
  const cy = tank.y + TANK_SIZE / 2 + dy * (TANK_SIZE / 2);
  const bullet: Bullet = {
    id: state.nextId++,
    tankId: tank.id,
    owner: tank.owner,
    x: cx - BULLET_SIZE / 2,
    y: cy - BULLET_SIZE / 2,
    px: cx - BULLET_SIZE / 2,
    py: cy - BULLET_SIZE / 2,
    dir: tank.dir,
    speed: bulletSpeedFor(tank),
    power: tank.kind === 'player' && tank.tier >= 3 ? 1 : 0,
    fromPlayer: tank.kind === 'player',
  };
  state.bullets.push(bullet);
  tank.bullets++;
  tank.cooldown = FIRE_COOLDOWN_TICKS;
  state.events.push({ type: 'shot', x: cx, y: cy, dir: tank.dir, slot: tank.owner });
  return true;
}

function removeBullet(state: GameState, bullet: Bullet): void {
  const idx = state.bullets.indexOf(bullet);
  if (idx >= 0) state.bullets.splice(idx, 1);
  const owner = state.tanks.find((t) => t.id === bullet.tankId);
  if (owner) owner.bullets = Math.max(0, owner.bullets - 1);
}

/** Destroys the wall segment a bullet hit. Returns true if the bullet hit something solid. */
function hitTiles(state: GameState, b: Bullet): boolean {
  const s = tileSpan(b.x, b.y, BULLET_SIZE, BULLET_SIZE);
  const vertical = b.dir === 0 || b.dir === 2;
  // swath: 2 tiles wide, centred on the bullet's perpendicular centre
  const c = vertical ? b.x + BULLET_SIZE / 2 : b.y + BULLET_SIZE / 2;
  const p0 = Math.floor((c - TILE / 2) / TILE);
  const p1 = Math.floor((c + TILE / 2 - 1) / TILE);
  const rows = vertical ? [s.y0, s.y1] : [s.x0, s.x1];
  const ordered = b.dir === 0 || b.dir === 3 ? [Math.min(...rows), Math.max(...rows)] : [Math.max(...rows), Math.min(...rows)];
  for (const r of ordered) {
    const cells: Array<[number, number]> = vertical ? [[p0, r], [p1, r]] : [[r, p0], [r, p1]];
    let solid = false;
    for (const [tx, ty] of cells) if (isSolidForBullet(getTile(state.tiles, tx, ty))) solid = true;
    if (!solid) continue;
    const depth = b.power ? 2 : 1;
    const [dx, dy] = DIRS[b.dir];
    for (let d = 0; d < depth; d++) {
      for (const [tx0, ty0] of cells) {
        const tx = tx0 + dx * d;
        const ty = ty0 + dy * d;
        const t = getTile(state.tiles, tx, ty);
        if (t === Tile.BASE) {
          destroyBase(state);
        } else if (t === Tile.BRICK || (t === Tile.STEEL && b.power)) {
          setTile(state, tx, ty, Tile.EMPTY);
          state.events.push({ type: 'brick', x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 });
        }
      }
    }
    return true;
  }
  return false;
}

export function destroyBase(state: GameState): void {
  if (!state.baseAlive) return;
  state.baseAlive = false;
  for (let i = 0; i < state.tiles.length; i++) {
    if (state.tiles[i] === Tile.BASE) {
      state.tiles[i] = Tile.BASE_DEAD;
      state.tileChanges.push(i);
    }
  }
  state.events.push({ type: 'baseDestroyed' });
  state.events.push({ type: 'explosion', x: 13 * TILE, y: 25 * TILE, big: true });
}

function damageEnemy(state: GameState, tank: Tank, bySlot: number): void {
  tank.hp--;
  if (tank.hp > 0) {
    state.events.push({ type: 'hit', x: tank.x + TANK_SIZE / 2, y: tank.y + TANK_SIZE / 2 });
    return;
  }
  const idx = state.tanks.indexOf(tank);
  if (idx >= 0) state.tanks.splice(idx, 1);
  state.enemies.killed++;
  const score = ENEMY_SCORE[tank.kind] ?? 100;
  const p = state.players[bySlot];
  if (p) {
    p.score += score;
    p.kills++;
    state.events.push({ type: 'score', slot: bySlot, amount: score, x: tank.x + TANK_SIZE / 2, y: tank.y + TANK_SIZE / 2 });
  }
  state.events.push({ type: 'tankDestroyed', kind: tank.kind, x: tank.x + TANK_SIZE / 2, y: tank.y + TANK_SIZE / 2, bySlot, owner: -1 });
  state.events.push({ type: 'explosion', x: tank.x + TANK_SIZE / 2, y: tank.y + TANK_SIZE / 2, big: true });
  if (tank.flashing) dropPowerUp(state);
}

function bulletHitsTank(state: GameState, b: Bullet, tank: Tank): 'pass' | 'absorb' | 'kill' {
  if (tank.spawnUntil > state.tick) return b.fromPlayer !== (tank.kind === 'player') ? 'absorb' : 'pass';
  const targetIsPlayer = tank.kind === 'player';
  if (b.fromPlayer && !targetIsPlayer) return tank.shieldUntil > state.tick ? 'absorb' : 'kill';
  if (!b.fromPlayer && targetIsPlayer) return tank.shieldUntil > state.tick ? 'absorb' : 'kill';
  if (b.fromPlayer && targetIsPlayer) {
    if (state.mode === 'versus' && b.owner !== tank.owner) return tank.shieldUntil > state.tick ? 'absorb' : 'kill';
    return 'pass';
  }
  return 'pass';
}

export function updateBullets(state: GameState): void {
  const bullets = state.bullets.slice();
  for (const b of bullets) {
    if (!state.bullets.includes(b)) continue;
    const [dx, dy] = DIRS[b.dir];
    b.px = b.x;
    b.py = b.y;
    b.x += dx * b.speed;
    b.y += dy * b.speed;
    if (b.x < 0 || b.y < 0 || b.x + BULLET_SIZE > FIELD || b.y + BULLET_SIZE > FIELD) {
      b.x = Math.max(0, Math.min(FIELD - BULLET_SIZE, b.x));
      b.y = Math.max(0, Math.min(FIELD - BULLET_SIZE, b.y));
      state.events.push({ type: 'hit', x: b.x + BULLET_SIZE / 2, y: b.y + BULLET_SIZE / 2 });
      removeBullet(state, b);
      continue;
    }
    if (hitTiles(state, b)) {
      state.events.push({ type: 'hit', x: b.x + BULLET_SIZE / 2, y: b.y + BULLET_SIZE / 2 });
      removeBullet(state, b);
      continue;
    }
    // tanks
    let consumed = false;
    for (const tank of state.tanks.slice()) {
      if (tank.id === b.tankId) continue;
      if (!rectsOverlap(b.x, b.y, BULLET_SIZE, BULLET_SIZE, tank.x, tank.y, TANK_SIZE, TANK_SIZE)) continue;
      const r = bulletHitsTank(state, b, tank);
      if (r === 'pass') continue;
      if (r === 'kill') {
        if (tank.kind === 'player') killPlayerTank(state, tank, b.owner);
        else damageEnemy(state, tank, b.owner);
      } else {
        state.events.push({ type: 'hit', x: b.x + BULLET_SIZE / 2, y: b.y + BULLET_SIZE / 2 });
      }
      consumed = true;
      break;
    }
    if (consumed) removeBullet(state, b);
  }
  // bullet vs bullet (swept along each bullet's travel axis so fast head-on bullets can't tunnel)
  const alive = state.bullets.slice();
  for (let i = 0; i < alive.length; i++) {
    for (let j = i + 1; j < alive.length; j++) {
      const a = alive[i];
      const c = alive[j];
      if (!state.bullets.includes(a) || !state.bullets.includes(c)) continue;
      if (a.owner === c.owner && a.owner === -1) continue; // enemy bullets pass each other
      if (a.fromPlayer && c.fromPlayer && state.mode === 'coop') continue;
      if (sweptOverlap(a, c)) {
        state.events.push({ type: 'hit', x: a.x + BULLET_SIZE / 2, y: a.y + BULLET_SIZE / 2 });
        removeBullet(state, a);
        removeBullet(state, c);
      }
    }
  }
}

function sweptOverlap(a: Bullet, c: Bullet): boolean {
  const ax0 = Math.min(a.px, a.x), ax1 = Math.max(a.px, a.x) + BULLET_SIZE;
  const ay0 = Math.min(a.py, a.y), ay1 = Math.max(a.py, a.y) + BULLET_SIZE;
  const cx0 = Math.min(c.px, c.x), cx1 = Math.max(c.px, c.x) + BULLET_SIZE;
  const cy0 = Math.min(c.py, c.y), cy1 = Math.max(c.py, c.y) + BULLET_SIZE;
  return ax0 < cx1 && cx0 < ax1 && ay0 < cy1 && cy0 < ay1;
}
