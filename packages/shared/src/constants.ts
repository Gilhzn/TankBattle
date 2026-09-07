/** Grid: 26x26 tiles of 8px. All sim coordinates are integer "sub-pixels" (SUB per px). */
export const GRID = 26;
export const TILE_PX = 8;
export const SUB = 8;
export const TILE = TILE_PX * SUB; // 64 sub per tile
export const FIELD = GRID * TILE; // 1664 sub
export const FIELD_PX = GRID * TILE_PX; // 208 px
export const TANK_SIZE = 2 * TILE; // 128 sub (16px)
export const BULLET_SIZE = 4 * SUB; // 32 sub (4px)
export const POWERUP_SIZE = 2 * TILE;

export const TICK_RATE = 30;
export const TICK_MS = 1000 / TICK_RATE;
export const MAX_PLAYERS = 4;
export const ENEMIES_PER_STAGE = 20;
export const MAX_ENEMIES_ON_SCREEN = 4;
/** 0-based indices in the spawn order that carry a power-up. */
export const FLASHING_ENEMY_INDICES = [3, 10, 17];

export const SPAWN_FLASH_TICKS = 30;
export const RESPAWN_DELAY_TICKS = 45;
export const RESPAWN_SHIELD_TICKS = 90;
export const HELMET_TICKS = 300;
export const CLOCK_TICKS = 300;
export const ENEMY_CLOCK_TICKS = 150;
export const SHOVEL_TICKS = 600;
export const SHOVEL_FLASH_TICKS = 90;
export const FIRE_COOLDOWN_TICKS = 6;
export const ICE_SLIDE_TICKS = 12;
export const STAGE_CLEAR_TICKS = 90;
export const VERSUS_DURATION_TICKS = 180 * TICK_RATE;
export const POWERUP_LIFETIME_TICKS = 30 * TICK_RATE;
export const STARTING_LIVES = 3;
export const MAX_LIVES = 9;
export const MAX_TIER = 3;

export const PLAYER_SPEED = 16; // sub per tick (2px)
export const ENEMY_SPEED: Record<string, number> = { basic: 12, fast: 24, power: 16, armor: 12 };
export const ENEMY_HP: Record<string, number> = { basic: 1, fast: 1, power: 1, armor: 4 };
export const ENEMY_FIRE_CHANCE: Record<string, number> = { basic: 2, fast: 3, power: 4, armor: 3 }; // percent per tick
export const ENEMY_SCORE: Record<string, number> = { basic: 100, fast: 200, power: 300, armor: 400 };
export const POWERUP_SCORE = 500;
export const BULLET_SPEED_SLOW = 32;
export const BULLET_SPEED_FAST = 64;

export const DIRS: ReadonlyArray<readonly [number, number]> = [
  [0, -1], // 0 up
  [1, 0], // 1 right
  [0, 1], // 2 down
  [-1, 0], // 3 left
];

/** Enemy spawn tiles (x) along the top row. */
export const ENEMY_SPAWN_TILES = [0, 12, 24];
/** Player spawn tiles (x) along the bottom row, by slot. */
export const PLAYER_SPAWN_TILES = [8, 16, 4, 20];
export const BASE_TILE_X = 12;
export const BASE_TILE_Y = 24;
