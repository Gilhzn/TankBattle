import { describe, expect, it } from 'vitest';
import { makeState, run, NONE, FIRE, p0Tank, fillTiles } from './helpers.js';
import { ENEMY_SPAWN_TILES, MAX_ENEMIES_ON_SCREEN, SPAWN_FLASH_TICKS, TILE, ENEMIES_PER_STAGE, CLOCK_TICKS } from '../constants.js';
import { enemiesOnScreen } from '../sim/enemies.js';
import { Tile } from '../types.js';
import { grenade } from '../sim/powerups.js';

describe('enemies', () => {
  it('spawns from the three top points, never more than the on-screen cap', () => {
    const s = makeState(5);
    const seenX = new Set<number>();
    for (let i = 0; i < 600; i++) {
      run(s, 1, [NONE]);
      expect(enemiesOnScreen(s)).toBeLessThanOrEqual(MAX_ENEMIES_ON_SCREEN);
      for (const t of s.tanks) if (t.kind !== 'player' && t.spawnUntil > s.tick) seenX.add(t.x / TILE);
    }
    expect(s.enemies.spawned).toBeGreaterThanOrEqual(MAX_ENEMIES_ON_SCREEN);
    for (const x of seenX) expect(ENEMY_SPAWN_TILES).toContain(x);
  });
  it('enemies do not move or fire while spawning, and move afterwards', () => {
    const s = makeState(9);
    run(s, 1, [NONE]);
    const e = s.tanks.find((t) => t.kind !== 'player')!;
    const y0 = e.y;
    run(s, SPAWN_FLASH_TICKS - 2, [NONE]);
    expect(e.y).toBe(y0);
    expect(s.bullets.length).toBe(0);
    run(s, 60, [NONE]);
    expect(e.x !== ENEMY_SPAWN_TILES[0] * TILE || e.y !== y0).toBe(true);
  });
  it('enemies #4, #11 and #18 are flashing power-up carriers', () => {
    const s = makeState(11);
    const flashing: number[] = [];
    let idx = 0;
    const seen = new Set<number>();
    for (let i = 0; i < 4000 && s.enemies.spawned < 20; i++) {
      run(s, 1, [NONE]);
      for (const t of s.tanks) {
        if (t.kind !== 'player' && !seen.has(t.id)) {
          seen.add(t.id);
          if (t.flashing) flashing.push(idx);
          idx++;
        }
      }
      // keep the field clear so spawning continues
      if (enemiesOnScreen(s) >= 3) grenade(s, 0);
    }
    expect(flashing).toEqual([3, 10, 17]);
  });
  it('freeze stops enemy movement and firing', () => {
    const s = makeState(13);
    run(s, SPAWN_FLASH_TICKS + 5, [NONE]);
    s.effects.freezeUntil = s.tick + CLOCK_TICKS;
    s.bullets = [];
    for (const t of s.tanks) t.bullets = 0;
    const positions = s.tanks.filter((t) => t.kind !== 'player').map((t) => [t.id, t.x, t.y]);
    run(s, 50, [NONE]);
    for (const [id, x, y] of positions) {
      const t = s.tanks.find((q) => q.id === id)!;
      expect([t.x, t.y]).toEqual([x, y]);
    }
    expect(s.bullets.filter((b) => !b.fromPlayer).length).toBe(0);
  });
  it('destroying all 20 enemies clears the stage and loads the next one', () => {
    const s = makeState(17);
    fillTiles(s, (tx, ty) => (ty < 22 ? Tile.EMPTY : undefined));
    let guard = 0;
    while (s.status === 'playing' && guard++ < 20000) {
      run(s, 1, [NONE]);
      if (enemiesOnScreen(s) > 0 && s.tanks.some((t) => t.kind !== 'player' && t.spawnUntil <= s.tick)) grenade(s, 0);
    }
    expect(s.status).toBe('stageClear');
    expect(s.enemies.killed).toBe(ENEMIES_PER_STAGE);
    run(s, 100, [NONE]);
    expect(s.stage).toBe(2);
    expect(s.status).toBe('playing');
    expect(p0Tank(s)).toBeTruthy();
    void FIRE;
  });
});
