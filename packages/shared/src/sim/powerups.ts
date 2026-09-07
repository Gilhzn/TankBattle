import {
  CLOCK_TICKS, ENEMY_CLOCK_TICKS, EXTRA_LIFE_BONUS_SCORE, HELMET_TICKS, MAX_LIVES, POWERUP_LIFETIME_TICKS, POWERUP_SCORE, POWERUP_SIZE, SHOVEL_FLASH_TICKS, SHOVEL_TICKS, TANK_SIZE, TILE, GRID, BULLET_SPEED_FAST,
} from '../constants.js';
import { baseRingTiles, getTile, rectsOverlap, setTile } from '../grid.js';
import { Tile, POWERUP_KINDS, VERSUS_POWERUP_KINDS, type GameState, type PowerUpKind, type Tank } from '../types.js';
import { makeRng, saveRng } from './state.js';
import { killPlayerTank, upgradePlayer } from './players.js';

/** The pickup pool for a match: versus runs a reduced set so no drop can decide a duel. */
export function powerUpPool(state: GameState): PowerUpKind[] {
  return state.mode === 'versus' ? VERSUS_POWERUP_KINDS : POWERUP_KINDS;
}

export function dropPowerUp(state: GameState): void {
  const rng = makeRng(state);
  const pool = powerUpPool(state);
  const kind = pool[rng.int(pool.length)];
  let x = 0;
  let y = 0;
  for (let attempt = 0; attempt < 30; attempt++) {
    const tx = rng.int(GRID - 2);
    const ty = rng.int(GRID - 6);
    let ok = true;
    for (let dy = 0; dy < 2 && ok; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        const t = getTile(state.tiles, tx + dx, ty + dy);
        if (t === Tile.STEEL || t === Tile.WATER || t === Tile.BASE) {
          ok = false;
          break;
        }
      }
    }
    x = tx * TILE;
    y = ty * TILE;
    if (ok) break;
  }
  saveRng(state, rng);
  state.powerUp = { kind, x, y, spawnedTick: state.tick };
  state.events.push({ type: 'powerupSpawn', kind, x: x + POWERUP_SIZE / 2, y: y + POWERUP_SIZE / 2 });
}

export function applyShovel(state: GameState): void {
  for (const [tx, ty] of baseRingTiles()) setTile(state, tx, ty, Tile.STEEL);
  state.effects.shovelUntil = state.tick + SHOVEL_TICKS;
}

export function updateShovel(state: GameState): void {
  const e = state.effects;
  if (e.shovelUntil === 0) return;
  const left = e.shovelUntil - state.tick;
  if (left <= 0) {
    for (const [tx, ty] of baseRingTiles()) setTile(state, tx, ty, Tile.BRICK);
    e.shovelUntil = 0;
    return;
  }
  if (left <= SHOVEL_FLASH_TICKS) {
    // flash: alternate steel/brick every 8 ticks
    const steel = Math.floor(left / 8) % 2 === 0;
    for (const [tx, ty] of baseRingTiles()) setTile(state, tx, ty, steel ? Tile.STEEL : Tile.BRICK);
  }
}

export function grenade(state: GameState, bySlot: number): void {
  for (const t of state.tanks.slice()) {
    if (t.kind === 'player') continue;
    const idx = state.tanks.indexOf(t);
    if (idx >= 0) state.tanks.splice(idx, 1);
    state.enemies.killed++;
    state.events.push({ type: 'explosion', x: t.x + TANK_SIZE / 2, y: t.y + TANK_SIZE / 2, big: true });
    state.events.push({ type: 'tankDestroyed', kind: t.kind, x: t.x + TANK_SIZE / 2, y: t.y + TANK_SIZE / 2, bySlot, owner: -1 });
  }
  state.events.push({ type: 'grenade' });
}

function applyToPlayer(state: GameState, kind: PowerUpKind, tank: Tank): void {
  const p = state.players[tank.owner];
  if (!p) return;
  switch (kind) {
    case 'star':
      upgradePlayer(state, p, 1);
      break;
    case 'gun':
      upgradePlayer(state, p, 3);
      break;
    case 'tank': {
      // Every other pickup shows itself on the tank or the field; this one only nudged a number in
      // the corner, so it read as "nothing happened". It now announces itself — and at the life cap
      // it pays out score instead of silently doing nothing at all.
      const capped = p.lives >= MAX_LIVES;
      if (!capped) p.lives++;
      else p.score += EXTRA_LIFE_BONUS_SCORE;
      state.events.push({ type: 'extraLife', slot: p.slot, lives: p.lives, converted: capped, x: tank.x + TANK_SIZE / 2, y: tank.y + TANK_SIZE / 2 });
      break;
    }
    case 'grenade':
      grenade(state, p.slot);
      break;
    case 'clock':
      state.effects.freezeUntil = state.tick + CLOCK_TICKS;
      state.events.push({ type: 'freeze' });
      break;
    case 'shovel':
      applyShovel(state);
      break;
    case 'helmet':
      tank.shieldUntil = Math.max(tank.shieldUntil, state.tick + HELMET_TICKS);
      break;
    case 'ship':
      tank.ship = true;
      break;
  }
  p.score += POWERUP_SCORE;
  state.events.push({ type: 'score', slot: p.slot, amount: POWERUP_SCORE, x: tank.x + TANK_SIZE / 2, y: tank.y + TANK_SIZE / 2 });
}

/** Tank 1990 twist: enemies can grab power-ups too, with inverted effects. */
function applyToEnemy(state: GameState, kind: PowerUpKind, tank: Tank): void {
  switch (kind) {
    case 'star':
    case 'gun':
      tank.tier = 1; // fast bullets
      tank.speed = Math.min(24, tank.speed + 4);
      break;
    case 'tank':
      state.enemies.queue.push('armor');
      state.enemies.total++;
      break;
    case 'grenade':
      for (const t of state.tanks.slice()) {
        if (t.kind === 'player' && t.shieldUntil <= state.tick) killPlayerTank(state, t, -1);
      }
      break;
    case 'clock':
      state.effects.playerFreezeUntil = state.tick + ENEMY_CLOCK_TICKS;
      state.events.push({ type: 'freeze' });
      break;
    case 'shovel':
      for (const [tx, ty] of baseRingTiles()) setTile(state, tx, ty, Tile.EMPTY);
      state.effects.shovelUntil = 0;
      break;
    case 'helmet':
      tank.shieldUntil = state.tick + HELMET_TICKS;
      break;
    case 'ship':
      tank.ship = true;
      break;
  }
  void BULLET_SPEED_FAST;
}

export function updatePowerUps(state: GameState): void {
  const pu = state.powerUp;
  if (!pu) return;
  if (state.tick - pu.spawnedTick > POWERUP_LIFETIME_TICKS) {
    state.powerUp = null;
    return;
  }
  for (const tank of state.tanks) {
    if (tank.spawnUntil > state.tick) continue;
    if (!rectsOverlap(tank.x, tank.y, TANK_SIZE, TANK_SIZE, pu.x, pu.y, POWERUP_SIZE, POWERUP_SIZE)) continue;
    state.powerUp = null;
    state.events.push({ type: 'pickup', kind: pu.kind, slot: tank.owner, x: pu.x + POWERUP_SIZE / 2, y: pu.y + POWERUP_SIZE / 2 });
    if (tank.kind === 'player') applyToPlayer(state, pu.kind, tank);
    else applyToEnemy(state, pu.kind, tank);
    return;
  }
}
