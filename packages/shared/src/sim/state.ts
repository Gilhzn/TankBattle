import {
  DIFFICULTY, ENEMIES_PER_STAGE, GRID, MAX_ENEMIES_ON_SCREEN, STARTING_LIVES, TILE, VERSUS_DURATION_TICKS,
} from '../constants.js';
import { Rng, hashString } from '../rng.js';
import { getStageDef, expandRoster } from '../maps/generator.js';
import { VERSUS_ARENA } from '../maps/stages.js';
import { parseCells } from '../maps/format.js';
import type { DifficultyTuning } from '../constants.js';
import type { Difficulty, GameMode, GameState, PlayerSlot, StageDef } from '../types.js';
import { spawnPlayerTank } from './players.js';

export interface PlayerInit {
  id: string;
  name: string;
  skin?: string;
  lives?: number;
  tier?: number;
}

export function createInitialState(seed: number, stage: number, players: PlayerInit[], mode: GameMode = 'coop', difficulty: Difficulty = 'normal'): GameState {
  const tuning = DIFFICULTY[difficulty] ?? DIFFICULTY.normal;
  const state: GameState = {
    tick: 0,
    seed,
    rng: seed | 0,
    mode,
    difficulty,
    stage,
    tiles: new Uint8Array(GRID * GRID),
    tanks: [],
    bullets: [],
    powerUp: null,
    players: players.slice(0, 4).map((p, i) => ({
      slot: i,
      id: p.id,
      name: p.name,
      active: true,
      tankId: null,
      lives: p.lives ?? tuning.lives,
      score: 0,
      kills: 0,
      deaths: 0,
      tier: p.tier ?? 0,
      respawnAt: 0,
      skin: p.skin ?? 'default',
      usedItems: {},
    })),
    enemies: { queue: [], total: 0, spawned: 0, killed: 0, nextSpawnTick: 0, spawnIndex: 0, maxOnScreen: MAX_ENEMIES_ON_SCREEN },
    effects: { freezeUntil: 0, playerFreezeUntil: 0, shovelUntil: 0 },
    baseAlive: true,
    status: 'playing',
    statusSince: 0,
    nextId: 1,
    tileChanges: [],
    events: [],
    gameOverReason: null,
    timeLeft: mode === 'versus' ? VERSUS_DURATION_TICKS : 0,
  };
  loadStage(state, stage);
  return state;
}

/** The active difficulty tuning for a running game. */
export function tuningOf(state: GameState): DifficultyTuning {
  return DIFFICULTY[state.difficulty] ?? DIFFICULTY.normal;
}

export function stageDefFor(state: GameState, stage: number): StageDef {
  return state.mode === 'versus' ? VERSUS_ARENA : getStageDef(stage);
}

/** Resets the field for a stage, keeping player lives/score/tier. */
export function loadStage(state: GameState, stage: number): void {
  const def = stageDefFor(state, stage);
  state.stage = stage;
  state.tiles = parseCells(def.cells, state.mode === 'coop');
  state.tileChanges = [];
  state.tanks = [];
  state.bullets = [];
  state.powerUp = null;
  state.baseAlive = state.mode === 'coop';
  state.effects = { freezeUntil: 0, playerFreezeUntil: 0, shovelUntil: 0 };
  state.status = 'playing';
  state.statusSince = state.tick;
  state.gameOverReason = null;
  const roster = state.mode === 'coop' ? expandRoster(def.roster) : [];
  state.enemies = {
    queue: roster,
    total: roster.length,
    spawned: 0,
    killed: 0,
    nextSpawnTick: state.tick,
    spawnIndex: 0,
    maxOnScreen: Math.min(tuningOf(state).maxOnScreen + Math.max(0, activePlayers(state).length - 2), 6),
  };
  for (const p of state.players) {
    p.tankId = null;
    p.respawnAt = 0;
    if (p.active && (p.lives > 0 || state.mode === 'versus')) spawnPlayerTank(state, p);
  }
  state.events.push({ type: 'stageStart', stage });
  void ENEMIES_PER_STAGE;
  void TILE;
}

export function activePlayers(state: GameState): PlayerSlot[] {
  return state.players.filter((p) => p.active);
}

export function cloneState(state: GameState): GameState {
  return {
    ...state,
    tiles: new Uint8Array(state.tiles),
    tanks: state.tanks.map((t) => ({ ...t, ai: { ...t.ai } })),
    bullets: state.bullets.map((b) => ({ ...b })),
    powerUp: state.powerUp ? { ...state.powerUp } : null,
    players: state.players.map((p) => ({ ...p, usedItems: { ...p.usedItems } })),
    enemies: { ...state.enemies, queue: [...state.enemies.queue] },
    effects: { ...state.effects },
    tileChanges: [...state.tileChanges],
    events: [...state.events],
  };
}

/** Stable FNV-1a hash of everything gameplay-relevant (ignores transient event/tileChange buffers). */
export function hashState(state: GameState): number {
  const canonical = JSON.stringify({
    tick: state.tick,
    rng: state.rng,
    stage: state.stage,
    tiles: Array.from(state.tiles),
    tanks: state.tanks,
    bullets: state.bullets,
    powerUp: state.powerUp,
    players: state.players,
    enemies: state.enemies,
    effects: state.effects,
    baseAlive: state.baseAlive,
    status: state.status,
    timeLeft: state.timeLeft,
  });
  return hashString(canonical);
}

export function makeRng(state: GameState): Rng {
  return new Rng(state.rng);
}
export function saveRng(state: GameState, rng: Rng): void {
  state.rng = rng.state;
}
