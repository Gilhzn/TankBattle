import {
  ENEMY_FIRE_CHANCE, ENEMY_HP, ENEMY_SPAWN_TILES, ENEMY_SPEED, FLASHING_ENEMY_INDICES, SPAWN_FLASH_TICKS, TANK_SIZE, TILE, GRID, BASE_TILE_X,
} from '../constants.js';
import type { Dir, GameState, Tank } from '../types.js';
import { moveTank, positionFree } from './movement.js';
import { tryFire } from './bullets.js';
import { makeRng, saveRng } from './state.js';

export function enemiesOnScreen(state: GameState): number {
  let n = 0;
  for (const t of state.tanks) if (t.kind !== 'player') n++;
  return n;
}

export function spawnInterval(state: GameState): number {
  const players = state.players.filter((p) => p.active).length;
  return Math.max(20, 95 - state.stage * 2 - (players - 1) * 10);
}

export function spawnEnemies(state: GameState): void {
  const e = state.enemies;
  if (e.queue.length === 0) return;
  if (state.tick < e.nextSpawnTick) return;
  if (enemiesOnScreen(state) >= e.maxOnScreen) return;
  const tx = ENEMY_SPAWN_TILES[e.spawnIndex % ENEMY_SPAWN_TILES.length];
  const x = tx * TILE;
  const y = 0;
  if (!positionFree(state, null, x, y, true)) {
    // rotate to the next spawn point and retry shortly
    e.spawnIndex++;
    e.nextSpawnTick = state.tick + 10;
    return;
  }
  const kind = e.queue.shift()!;
  const idx = e.spawned;
  const tank: Tank = {
    id: state.nextId++,
    owner: -1,
    kind,
    x,
    y,
    dir: 2,
    tier: 0,
    hp: ENEMY_HP[kind],
    maxHp: ENEMY_HP[kind],
    speed: ENEMY_SPEED[kind],
    moving: false,
    shieldUntil: 0,
    spawnUntil: state.tick + SPAWN_FLASH_TICKS,
    ship: false,
    flashing: FLASHING_ENEMY_INDICES.includes(idx),
    bullets: 0,
    cooldown: 0,
    slide: 0,
    ai: { timer: 0, blocked: 0 },
    skin: 'enemy',
  };
  state.tanks.push(tank);
  e.spawned++;
  e.spawnIndex++;
  e.nextSpawnTick = state.tick + spawnInterval(state);
  state.events.push({ type: 'spawn', x: x + TANK_SIZE / 2, y: y + TANK_SIZE / 2, kind });
}

function chooseDir(state: GameState, tank: Tank, rng: { int(n: number): number }): Dir {
  const baseX = (BASE_TILE_X + 1) * TILE - TANK_SIZE / 2;
  const towardBase: Dir = tank.x < baseX ? 1 : 3;
  const aggression = Math.min(40, state.stage * 3);
  const roll = rng.int(100);
  const nearBottom = tank.y > (GRID * TILE * 2) / 3;
  if (roll < (nearBottom ? 20 : 35) + aggression / 2) return 2;
  if (roll < (nearBottom ? 60 : 55) + aggression) return towardBase;
  return rng.int(4) as Dir;
}

export function updateEnemies(state: GameState): void {
  const rng = makeRng(state);
  const frozen = state.effects.freezeUntil > state.tick;
  for (const tank of state.tanks.slice()) {
    if (tank.kind === 'player') continue;
    if (!state.tanks.includes(tank)) continue;
    if (tank.cooldown > 0) tank.cooldown--;
    if (tank.spawnUntil > state.tick) continue;
    if (frozen) {
      tank.moving = false;
      continue;
    }
    tank.ai.timer--;
    if (tank.ai.timer <= 0) {
      tank.dir = chooseDir(state, tank, rng);
      tank.ai.timer = 30 + rng.int(60);
      tank.ai.blocked = 0;
    }
    const moved = moveTank(state, tank, tank.dir, tank.speed);
    tank.moving = moved > 0;
    if (moved < tank.speed) {
      tank.ai.blocked++;
      if (tank.ai.blocked >= 3) {
        tank.dir = chooseDir(state, tank, rng);
        tank.ai.timer = 20 + rng.int(40);
        tank.ai.blocked = 0;
      }
    }
    const fireChance = (ENEMY_FIRE_CHANCE[tank.kind] ?? 2) + Math.floor(state.stage / 4);
    if (rng.int(100) < fireChance) tryFire(state, tank);
  }
  saveRng(state, rng);
}
