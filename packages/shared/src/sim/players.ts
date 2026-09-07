import {
  MAX_TIER, PLAYER_SPEED, PLAYER_SPAWN_TILES, RESPAWN_DELAY_TICKS, RESPAWN_SHIELD_TICKS, TANK_SIZE, TILE, GRID, ICE_SLIDE_TICKS,
} from '../constants.js';
import type { GameState, Input, PlayerSlot, Tank } from '../types.js';
import { moveTank, positionFree, tankOnIce } from './movement.js';
import { tryFire } from './bullets.js';

export function playerSpawnPos(slot: number): { x: number; y: number } {
  const tx = PLAYER_SPAWN_TILES[slot % PLAYER_SPAWN_TILES.length];
  return { x: tx * TILE, y: (GRID - 2) * TILE };
}

export function spawnPlayerTank(state: GameState, p: PlayerSlot): Tank | null {
  const pos = playerSpawnPos(p.slot);
  if (!positionFree(state, null, pos.x, pos.y, true)) {
    // try neighbouring lanes so a blocked spawn never soft-locks a player
    let found = false;
    for (let off = 1; off <= 4 && !found; off++) {
      for (const sx of [pos.x - off * TILE, pos.x + off * TILE]) {
        if (sx >= 0 && sx + TANK_SIZE <= GRID * TILE && positionFree(state, null, sx, pos.y, true)) {
          pos.x = sx;
          found = true;
          break;
        }
      }
    }
    if (!found) return null;
  }
  const tank: Tank = {
    id: state.nextId++,
    owner: p.slot,
    kind: 'player',
    x: pos.x,
    y: pos.y,
    dir: 0,
    tier: p.tier,
    hp: 1,
    maxHp: 1,
    speed: PLAYER_SPEED,
    moving: false,
    shieldUntil: state.tick + RESPAWN_SHIELD_TICKS,
    spawnUntil: 0,
    ship: false,
    flashing: false,
    bullets: 0,
    cooldown: 0,
    slide: 0,
    ai: { timer: 0, blocked: 0 },
    skin: p.skin,
  };
  state.tanks.push(tank);
  p.tankId = tank.id;
  state.events.push({ type: 'spawn', x: tank.x + TANK_SIZE / 2, y: tank.y + TANK_SIZE / 2, kind: 'player' });
  return tank;
}

export function playerTank(state: GameState, p: PlayerSlot): Tank | undefined {
  if (p.tankId === null) return undefined;
  return state.tanks.find((t) => t.id === p.tankId);
}

export function killPlayerTank(state: GameState, tank: Tank, bySlot: number): void {
  const p = state.players[tank.owner];
  const idx = state.tanks.indexOf(tank);
  if (idx >= 0) state.tanks.splice(idx, 1);
  state.events.push({ type: 'explosion', x: tank.x + TANK_SIZE / 2, y: tank.y + TANK_SIZE / 2, big: true });
  state.events.push({ type: 'tankDestroyed', kind: 'player', x: tank.x + TANK_SIZE / 2, y: tank.y + TANK_SIZE / 2, bySlot, owner: tank.owner });
  if (!p) return;
  p.tankId = null;
  p.deaths++;
  p.tier = 0;
  state.events.push({ type: 'playerDied', slot: p.slot });
  if (state.mode === 'versus') {
    const killer = state.players[bySlot];
    if (killer && killer.slot !== p.slot) {
      killer.kills++;
      killer.score += 1000;
      state.events.push({ type: 'score', slot: killer.slot, amount: 1000, x: tank.x + TANK_SIZE / 2, y: tank.y + TANK_SIZE / 2 });
    }
    p.respawnAt = state.tick + RESPAWN_DELAY_TICKS;
    return;
  }
  p.lives--;
  if (p.lives > 0) p.respawnAt = state.tick + RESPAWN_DELAY_TICKS;
}

export function updatePlayers(state: GameState, inputs: ReadonlyArray<Input | null | undefined>): void {
  for (const p of state.players) {
    if (!p.active) continue;
    let tank = playerTank(state, p);
    if (!tank) {
      const canRespawn = state.mode === 'versus' || p.lives > 0;
      if (canRespawn && p.respawnAt > 0 && state.tick >= p.respawnAt) {
        const t = spawnPlayerTank(state, p);
        if (t) p.respawnAt = 0;
      }
      continue;
    }
    if (tank.cooldown > 0) tank.cooldown--;
    const frozen = state.effects.playerFreezeUntil > state.tick;
    const input = frozen ? null : inputs[p.slot];
    const dir: number = input && input.dir >= 0 ? input.dir : -1;
    if (dir >= 0) {
      tank.slide = 0;
      const moved = moveTank(state, tank, dir as 0 | 1 | 2 | 3, tank.speed);
      tank.moving = moved > 0;
    } else if (tank.slide > 0) {
      tank.slide--;
      const moved = moveTank(state, tank, tank.dir, tank.speed);
      if (moved === 0) tank.slide = 0;
      tank.moving = moved > 0 && tank.slide > 0;
    } else {
      if (tank.moving && tankOnIce(state, tank)) tank.slide = ICE_SLIDE_TICKS;
      tank.moving = false;
    }
    if (input?.fire && !frozen) tryFire(state, tank);
    tank = undefined;
  }
}

export function upgradePlayer(state: GameState, p: PlayerSlot, tiers = 1): void {
  p.tier = Math.min(MAX_TIER, p.tier + tiers);
  const t = playerTank(state, p);
  if (t) t.tier = p.tier;
}
