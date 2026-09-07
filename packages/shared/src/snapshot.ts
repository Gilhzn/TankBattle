import { GRID } from './constants.js';
import { decodeTiles, encodeTiles } from './grid.js';
import type { Dir, GameMode, GameState, GameStatus, PowerUpKind, TankKind, TickEvent } from './types.js';

export const TankFlag = { MOVING: 1, SHIELD: 2, SPAWNING: 4, SHIP: 8, FLASHING: 16, FROZEN: 32 } as const;

/** [id, owner, kind, x, y, dir, tier, hp, maxHp, flags, skin] */
export type TankDTO = [number, number, TankKind, number, number, Dir, number, number, number, number, string];
/** [id, x, y, dir, fromPlayer, speed] */
export type BulletDTO = [number, number, number, Dir, number, number];

export interface PlayerDTO {
  slot: number;
  id: string;
  name: string;
  active: boolean;
  tankId: number | null;
  lives: number;
  score: number;
  kills: number;
  deaths: number;
  tier: number;
  skin: string;
  respawnIn: number;
}

export interface Snapshot {
  t: number;
  full: boolean;
  stage: number;
  stageName?: string;
  mode: GameMode;
  status: GameStatus;
  tiles?: string;
  tileChanges?: number[]; // flat [idx, tile, idx, tile, ...]
  tanks: TankDTO[];
  bullets: BulletDTO[];
  powerUp: { kind: PowerUpKind; x: number; y: number } | null;
  players: PlayerDTO[];
  enemies: { remaining: number; killed: number; total: number; onScreen: number };
  effects: { freeze: number; playerFreeze: number; shovel: number };
  baseAlive: boolean;
  timeLeft: number;
  gameOverReason: 'base' | 'lives' | 'time' | null;
  events: TickEvent[];
}

/** Client-side mirror of the authoritative state, built from snapshots. */
export interface ViewState extends Omit<Snapshot, 'tiles' | 'tileChanges' | 'full'> {
  tiles: Uint8Array;
}

export function encodeSnapshot(state: GameState, full: boolean, stageName?: string): Snapshot {
  const snap: Snapshot = {
    t: state.tick,
    full,
    stage: state.stage,
    stageName,
    mode: state.mode,
    status: state.status,
    tanks: state.tanks.map((t) => [
      t.id,
      t.owner,
      t.kind,
      t.x,
      t.y,
      t.dir,
      t.tier,
      t.hp,
      t.maxHp,
      (t.moving ? TankFlag.MOVING : 0) |
        (t.shieldUntil > state.tick ? TankFlag.SHIELD : 0) |
        (t.spawnUntil > state.tick ? TankFlag.SPAWNING : 0) |
        (t.ship ? TankFlag.SHIP : 0) |
        (t.flashing ? TankFlag.FLASHING : 0) |
        ((t.kind !== 'player' && state.effects.freezeUntil > state.tick) || (t.kind === 'player' && state.effects.playerFreezeUntil > state.tick)
          ? TankFlag.FROZEN
          : 0),
      t.skin,
    ]),
    bullets: state.bullets.map((b) => [b.id, b.x, b.y, b.dir, b.fromPlayer ? 1 : 0, b.speed]),
    powerUp: state.powerUp ? { kind: state.powerUp.kind, x: state.powerUp.x, y: state.powerUp.y } : null,
    players: state.players.map((p) => ({
      slot: p.slot,
      id: p.id,
      name: p.name,
      active: p.active,
      tankId: p.tankId,
      lives: p.lives,
      score: p.score,
      kills: p.kills,
      deaths: p.deaths,
      tier: p.tier,
      skin: p.skin,
      respawnIn: p.respawnAt > state.tick ? p.respawnAt - state.tick : 0,
    })),
    enemies: {
      remaining: state.enemies.queue.length,
      killed: state.enemies.killed,
      total: state.enemies.total,
      onScreen: state.tanks.filter((t) => t.kind !== 'player').length,
    },
    effects: {
      freeze: Math.max(0, state.effects.freezeUntil - state.tick),
      playerFreeze: Math.max(0, state.effects.playerFreezeUntil - state.tick),
      shovel: Math.max(0, state.effects.shovelUntil - state.tick),
    },
    baseAlive: state.baseAlive,
    timeLeft: state.timeLeft,
    gameOverReason: state.gameOverReason,
    events: state.events,
  };
  if (full) {
    snap.tiles = encodeTiles(state.tiles);
  } else {
    const changes: number[] = [];
    const seen = new Set<number>();
    for (const i of state.tileChanges) {
      if (seen.has(i)) continue;
      seen.add(i);
      changes.push(i, state.tiles[i]);
    }
    snap.tileChanges = changes;
  }
  return snap;
}

export function createViewState(): ViewState {
  return {
    t: 0,
    stage: 1,
    mode: 'coop',
    status: 'playing',
    tiles: new Uint8Array(GRID * GRID),
    tanks: [],
    bullets: [],
    powerUp: null,
    players: [],
    enemies: { remaining: 0, killed: 0, total: 0, onScreen: 0 },
    effects: { freeze: 0, playerFreeze: 0, shovel: 0 },
    baseAlive: true,
    timeLeft: 0,
    gameOverReason: null,
    events: [],
  };
}

/** Applies a full or delta snapshot onto a view state. Returns false if a delta arrived without a prior full. */
export function applySnapshot(view: ViewState, snap: Snapshot, hasFull: boolean): boolean {
  if (!snap.full && !hasFull) return false;
  if (snap.full && snap.tiles) view.tiles = decodeTiles(snap.tiles);
  else if (snap.tileChanges) {
    for (let i = 0; i < snap.tileChanges.length; i += 2) view.tiles[snap.tileChanges[i]] = snap.tileChanges[i + 1];
  }
  view.t = snap.t;
  view.stage = snap.stage;
  if (snap.stageName) view.stageName = snap.stageName;
  view.mode = snap.mode;
  view.status = snap.status;
  view.tanks = snap.tanks;
  view.bullets = snap.bullets;
  view.powerUp = snap.powerUp;
  view.players = snap.players;
  view.enemies = snap.enemies;
  view.effects = snap.effects;
  view.baseAlive = snap.baseAlive;
  view.timeLeft = snap.timeLeft;
  view.gameOverReason = snap.gameOverReason;
  view.events = snap.events;
  return true;
}
