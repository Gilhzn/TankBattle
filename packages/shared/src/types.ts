export type Dir = 0 | 1 | 2 | 3;

export const Tile = {
  EMPTY: 0,
  BRICK: 1,
  STEEL: 2,
  TREES: 3,
  WATER: 4,
  ICE: 5,
  BASE: 6,
  BASE_DEAD: 7,
} as const;
export type TileId = (typeof Tile)[keyof typeof Tile];

export type TankKind = 'player' | 'basic' | 'fast' | 'power' | 'armor';
export type EnemyKind = Exclude<TankKind, 'player'>;
export type PowerUpKind = 'star' | 'tank' | 'grenade' | 'clock' | 'shovel' | 'helmet' | 'ship' | 'gun';
export const POWERUP_KINDS: PowerUpKind[] = ['star', 'tank', 'grenade', 'clock', 'shovel', 'helmet', 'ship', 'gun'];

/**
 * Pickups allowed in player-vs-player matches. A duel is decided by aim and position, so the
 * match-swinging pickups are cut: `grenade` wipes the field from across the map, `gun`/`star` hand
 * one player a permanently better weapon, `clock` freezes the opponent, and `shovel` only protects
 * a base no versus arena has. What is left is small and situational — a shield, water crossing, and
 * the extra life that keeps a losing player in the match without deciding it.
 */
export const VERSUS_POWERUP_KINDS: PowerUpKind[] = ['helmet', 'ship', 'tank'];
export type GameMode = 'coop' | 'versus';
/**
 * How a versus match splits its seats. 'ffa' is every player for themselves (up to 4); 'teams' is
 * 2v2, where teammates cannot shoot each other and win or lose together.
 */
export type VersusFormat = 'ffa' | 'teams';
export type Difficulty = 'easy' | 'normal' | 'hard';
export type GameStatus = 'playing' | 'stageClear' | 'gameOver';

export interface AiState {
  timer: number;
  blocked: number;
}

export interface Tank {
  id: number;
  /** Player slot 0..3, or -1 for AI. */
  owner: number;
  kind: TankKind;
  x: number;
  y: number;
  dir: Dir;
  tier: number;
  hp: number;
  maxHp: number;
  speed: number;
  moving: boolean;
  shieldUntil: number;
  spawnUntil: number;
  ship: boolean;
  flashing: boolean;
  bullets: number;
  cooldown: number;
  slide: number;
  ai: AiState;
  skin: string;
  /** Side this tank fights for: the owner's team in versus, -1 for AI and for every co-op tank. */
  team: number;
}

export interface Bullet {
  id: number;
  tankId: number;
  owner: number;
  x: number;
  y: number;
  px: number;
  py: number;
  dir: Dir;
  speed: number;
  power: number;
  fromPlayer: boolean;
}

export interface PowerUp {
  kind: PowerUpKind;
  x: number;
  y: number;
  spawnedTick: number;
}

export interface PlayerSlot {
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
  respawnAt: number;
  skin: string;
  /** Side in versus: own slot in free-for-all, 0 or 1 in 2v2. -1 in co-op, where everyone allies. */
  team: number;
  /** In-match consumable use counters, enforced by the server. */
  usedItems: Record<string, number>;
}

export interface EnemyState {
  queue: EnemyKind[];
  total: number;
  spawned: number;
  killed: number;
  nextSpawnTick: number;
  spawnIndex: number;
  maxOnScreen: number;
}

export interface Effects {
  freezeUntil: number;
  playerFreezeUntil: number;
  shovelUntil: number;
}

export interface Input {
  dir: Dir | -1;
  fire: boolean;
}

export type Command =
  | { type: 'grenade'; slot: number }
  | { type: 'clock'; slot: number }
  | { type: 'shield'; slot: number; ticks: number }
  | { type: 'life'; slot: number }
  | { type: 'star'; slot: number }
  | { type: 'revive'; slot: number }
  | { type: 'removePlayer'; slot: number }
  | { type: 'addPlayer'; slot: number; id: string; name: string; skin: string };

export type TickEvent =
  | { type: 'shot'; x: number; y: number; dir: Dir; slot: number }
  | { type: 'hit'; x: number; y: number }
  | { type: 'brick'; x: number; y: number }
  | { type: 'explosion'; x: number; y: number; big: boolean }
  | { type: 'spawn'; x: number; y: number; kind: TankKind }
  | { type: 'tankDestroyed'; kind: TankKind; x: number; y: number; bySlot: number; owner: number }
  | { type: 'playerDied'; slot: number }
  | { type: 'pickup'; kind: PowerUpKind; slot: number; x: number; y: number }
  | { type: 'powerupSpawn'; kind: PowerUpKind; x: number; y: number }
  | { type: 'score'; slot: number; amount: number; x: number; y: number }
  /** An extra life landed (or was converted to score because the player was already capped). */
  | { type: 'extraLife'; slot: number; lives: number; converted: boolean; x: number; y: number }
  | { type: 'baseDestroyed' }
  | { type: 'stageClear'; stage: number }
  | { type: 'gameOver'; reason: 'base' | 'lives' | 'time' | 'eliminated' }
  /** A versus player spent their last life and is out for the rest of the match. */
  | { type: 'eliminated'; slot: number; team: number }
  | { type: 'stageStart'; stage: number }
  | { type: 'freeze' }
  | { type: 'grenade' };

export interface GameState {
  tick: number;
  seed: number;
  rng: number;
  mode: GameMode;
  difficulty: Difficulty;
  stage: number;
  tiles: Uint8Array;
  tanks: Tank[];
  bullets: Bullet[];
  powerUp: PowerUp | null;
  players: PlayerSlot[];
  enemies: EnemyState;
  effects: Effects;
  baseAlive: boolean;
  status: GameStatus;
  statusSince: number;
  nextId: number;
  /** Tile indices changed since the last snapshot flush (server clears). */
  tileChanges: number[];
  events: TickEvent[];
  gameOverReason: 'base' | 'lives' | 'time' | 'eliminated' | null;
  timeLeft: number;
  /** Seat split for a versus match. Meaningless (and always 'ffa') in co-op. */
  versusFormat: VersusFormat;
}

export interface StageDef {
  name: string;
  cells: string[]; // 13 rows x 13 cols
  roster: [EnemyKind, number][];
}
