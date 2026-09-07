import {
  BULLET_SIZE, DIRS, FIELD, GRID, TANK_SIZE, TILE, Tile,
  getTile, isSolidForBullet, isSolidForTank, positionFree, rectsOverlap,
  type Dir, type GameState, type Input, type PlayerSlot, type Tank,
} from '@tank/shared';

/** Tiles a tank covers on each axis. */
const SPAN = TANK_SIZE / TILE;

/**
 * The versus fill-in opponent.
 *
 * It drives an ordinary player seat through the same input channel a human uses — no privileged
 * access to the simulation beyond reading it, no extra speed, no extra lives. Its skill is tuned to
 * the human's rating so the match stays close: the point is a game worth playing when nobody is
 * queueing, not an opponent that cannot be beaten.
 */

/** How far ahead the bot looks for a bullet that is about to hit it, in ticks. */
const DODGE_HORIZON = 12;
/** Distance within which it prefers grabbing a pickup to chasing. */
const PICKUP_INTEREST = TILE * 7;

export interface BotSkill {
  /** 0..1. Drives every other number here. */
  level: number;
  /** Ticks between decisions. A slower bot commits to a heading for longer. */
  reactionTicks: number;
  /** How far off-centre a target may be and still be shot at, in sub-pixels. */
  aimTolerance: number;
  /** Chance per decision of noticing an incoming bullet at all. */
  dodgeChance: number;
  /** Chance per decision of simply not firing when it could — a missed opportunity. */
  hesitation: number;
  /** Chance of picking a random heading instead of the best one. */
  wander: number;
}

/**
 * Maps an opponent rating onto a skill level. 800 and below plays like someone still learning the
 * controls; 1800 and above plays close to optimally. Between those it scales linearly, so a player
 * meets an opponent that feels like the players around them on the ladder.
 */
export function skillForRating(rating: number): BotSkill {
  const level = Math.max(0, Math.min(1, (rating - 800) / 1000));
  return {
    level,
    reactionTicks: Math.round(9 - level * 7), // 9 ticks (~0.3s) down to 2
    // Two tanks connect while their perpendicular offset is under about half a tank, so the window
    // is scaled against TANK_SIZE rather than TILE. A tighter number than the movement grid can
    // actually produce does not make the bot accurate — it makes it never fire at all.
    aimTolerance: TANK_SIZE * (0.85 - level * 0.3),
    dodgeChance: 0.25 + level * 0.7,
    hesitation: 0.35 - level * 0.32,
    wander: 0.3 - level * 0.26,
  };
}

const OPPOSITE: Record<Dir, Dir> = { 0: 2, 1: 3, 2: 0, 3: 1 };
const PERPENDICULAR: Record<Dir, [Dir, Dir]> = { 0: [1, 3], 1: [0, 2], 2: [1, 3], 3: [0, 2] };

interface Threat {
  dir: Dir;
  ticks: number;
}

export class VersusBot {
  private cooldown = 0;
  private heading: Dir = 0;
  private wanderUntil = 0;

  constructor(
    readonly slot: number,
    readonly skill: BotSkill,
    private readonly rnd: () => number = Math.random,
  ) {}

  /** The input this bot wants this tick. */
  think(state: GameState): Input {
    const me = this.myTank(state);
    if (!me) return { dir: -1, fire: false };

    // Between decisions it keeps driving the heading it committed to. This is what reaction time
    // actually looks like from the outside: a slower opponent keeps going the wrong way for longer.
    if (this.cooldown > 0) {
      this.cooldown--;
      return { dir: this.blocked(state, me, this.heading) ? this.sidestep(state, me, this.heading) : this.heading, fire: false };
    }
    this.cooldown = this.skill.reactionTicks;

    const threat = this.incomingBullet(state, me);
    if (threat && this.rnd() < this.skill.dodgeChance) {
      const escape = this.dodge(state, me, threat.dir);
      if (escape !== null) {
        this.heading = escape;
        return { dir: escape, fire: false };
      }
    }

    const target = this.nearestOpponent(state, me);
    const pickup = this.worthwhilePickup(state, me, target);

    if (target && !pickup) {
      const shot = this.shotAt(state, me, target);
      if (shot !== null) {
        this.heading = shot;
        // Hesitation is a missed opening, not a wasted shell: it lines up but does not pull the
        // trigger, which is exactly how a weaker player loses a duel they were winning.
        return { dir: shot, fire: this.rnd() >= this.skill.hesitation };
      }
    }

    const goal = pickup ?? (target ? { x: target.x, y: target.y } : null);
    const dir = goal ? this.stepToward(state, me, goal.x, goal.y) : this.roam(state, me);
    this.heading = dir;
    return { dir, fire: false };
  }

  private myTank(state: GameState): Tank | undefined {
    const p: PlayerSlot | undefined = state.players[this.slot];
    if (!p || p.tankId === null) return undefined;
    return state.tanks.find((t) => t.id === p.tankId);
  }

  /** The closest tank the bot is allowed to shoot: an opponent, never a teammate. */
  private nearestOpponent(state: GameState, me: Tank): Tank | undefined {
    let best: Tank | undefined;
    let bestD = Infinity;
    for (const t of state.tanks) {
      if (t.id === me.id) continue;
      if (t.kind === 'player' && t.team >= 0 && t.team === me.team) continue;
      if (t.spawnUntil > state.tick) continue;
      const d = Math.abs(t.x - me.x) + Math.abs(t.y - me.y);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    return best;
  }

  /** A pickup worth the detour: closer than the opponent and not far away. */
  private worthwhilePickup(state: GameState, me: Tank, target: Tank | undefined): { x: number; y: number } | null {
    const pu = state.powerUp;
    if (!pu) return null;
    const d = Math.abs(pu.x - me.x) + Math.abs(pu.y - me.y);
    if (d > PICKUP_INTEREST) return null;
    if (target && Math.abs(target.x - me.x) + Math.abs(target.y - me.y) < d) return null;
    // A careless opponent walks past a shield; a sharp one always takes it.
    return this.rnd() < 0.4 + this.skill.level * 0.6 ? { x: pu.x, y: pu.y } : null;
  }

  /** A bullet heading for this tank within the look-ahead window. */
  private incomingBullet(state: GameState, me: Tank): Threat | null {
    for (const b of state.bullets) {
      if (b.tankId === me.id) continue;
      const [dx, dy] = DIRS[b.dir];
      // Only bullets travelling roughly at us matter; the rest will pass by.
      for (let t = 1; t <= DODGE_HORIZON; t++) {
        const bx = b.x + dx * b.speed * t;
        const by = b.y + dy * b.speed * t;
        if (bx < 0 || by < 0 || bx > FIELD || by > FIELD) break;
        if (rectsOverlap(bx, by, BULLET_SIZE, BULLET_SIZE, me.x, me.y, TANK_SIZE, TANK_SIZE)) return { dir: b.dir, ticks: t };
      }
    }
    return null;
  }

  /** A direction that clears the bullet's lane, preferring the side with more room. */
  private dodge(state: GameState, me: Tank, incoming: Dir): Dir | null {
    const [a, b] = PERPENDICULAR[incoming];
    const options = this.rnd() < 0.5 ? [a, b] : [b, a];
    for (const d of options) if (!this.blocked(state, me, d)) return d;
    // Nowhere sideways to go: back away along the bullet's own axis rather than stand still.
    const away = incoming;
    return this.blocked(state, me, away) ? null : away;
  }

  /**
   * The direction to shoot `target` from here, or null if there is no clean line. A clean line
   * means aligned on one axis, within the bot's aim tolerance, with no *indestructible* cover in
   * between — brick is worth shooting through, steel is not.
   */
  private shotAt(state: GameState, me: Tank, target: Tank): Dir | null {
    const dx = target.x - me.x;
    const dy = target.y - me.y;
    if (Math.abs(dy) <= this.skill.aimTolerance) {
      const dir: Dir = dx > 0 ? 1 : 3;
      if (this.lineOfFire(state, me, dir, Math.abs(dx))) return dir;
    }
    if (Math.abs(dx) <= this.skill.aimTolerance) {
      const dir: Dir = dy > 0 ? 2 : 0;
      if (this.lineOfFire(state, me, dir, Math.abs(dy))) return dir;
    }
    return null;
  }

  /** Walks the lane a shell would travel, stopping at the first thing it cannot break. */
  private lineOfFire(state: GameState, me: Tank, dir: Dir, distance: number): boolean {
    const [dx, dy] = DIRS[dir];
    const cx = me.x + TANK_SIZE / 2;
    const cy = me.y + TANK_SIZE / 2;
    for (let d = TANK_SIZE / 2; d < distance; d += TILE / 2) {
      const tx = Math.floor((cx + dx * d) / TILE);
      const ty = Math.floor((cy + dy * d) / TILE);
      const tile = getTile(state.tiles, tx, ty);
      // Water lets a shell over but stops a tank, so it is a *good* place to shoot across.
      if (isSolidForBullet(tile)) return false;
    }
    return true;
  }

  /**
   * The first step of a shortest path to a point.
   *
   * This used to walk greedily down the larger axis, which pins the bot in any concave corner: it
   * shuffles against the wall between it and its target forever. (The tell was that a *worse* bot
   * played better, because its larger random-wander share was what shook it loose.) A breadth-first
   * search over the 26x26 tile grid costs nothing at this size and actually goes around things.
   *
   * Brick is only treated as passable when there is no open route, in which case the bot walks up to
   * it and shoots through — which is what a person does with a wall in the way.
   */
  private stepToward(state: GameState, me: Tank, x: number, y: number): Dir {
    if (this.rnd() < this.skill.wander) return this.roam(state, me);
    const from = this.tileOf(me.x, me.y);
    const to = this.tileOf(x, y);
    const dir = this.bfsStep(state, me, from, to, false) ?? this.bfsStep(state, me, from, to, true);
    // The search already routed around the terrain, so second-guessing it here just makes the bot
    // dither. Only a tank standing in the way is worth stepping around.
    if (dir === null) return this.roam(state, me);
    return this.occupied(state, me, dir) ? this.sidestep(state, me, dir) : dir;
  }

  /** Another tank is in the square we want to step into. */
  private occupied(state: GameState, me: Tank, dir: Dir): boolean {
    const [dx, dy] = DIRS[dir];
    return !positionFree(state, me, me.x + dx * me.speed, me.y + dy * me.speed, me.ship);
  }

  private tileOf(x: number, y: number): number {
    const tx = Math.max(0, Math.min(GRID - SPAN, Math.round(x / TILE)));
    const ty = Math.max(0, Math.min(GRID - SPAN, Math.round(y / TILE)));
    return ty * GRID + tx;
  }

  /** Whether a tank fits with its top-left corner on this tile. */
  private fits(state: GameState, me: Tank, tx: number, ty: number, throughBrick: boolean): boolean {
    if (tx < 0 || ty < 0 || tx + SPAN > GRID || ty + SPAN > GRID) return false;
    for (let y = ty; y < ty + SPAN; y++) {
      for (let x = tx; x < tx + SPAN; x++) {
        const tile = getTile(state.tiles, x, y);
        if (throughBrick && tile === Tile.BRICK) continue;
        if (isSolidForTank(tile, me.ship)) return false;
      }
    }
    return true;
  }

  /**
   * Breadth-first from the goal outward, stopping as soon as the bot's own tile is reached; the
   * direction that got there is the step to take. Searching from the goal means one sweep answers
   * "which way is downhill" without reconstructing a whole path.
   */
  private bfsStep(state: GameState, me: Tank, from: number, to: number, throughBrick: boolean): Dir | null {
    if (from === to) return null;
    if (!this.fits(state, me, to % GRID, Math.floor(to / GRID), throughBrick)) {
      // The goal tile itself is blocked (a tank is standing there): aim at its open neighbours.
      const alternatives = this.neighbours(to).filter((n) => this.fits(state, me, n % GRID, Math.floor(n / GRID), throughBrick));
      if (!alternatives.length) return null;
      to = alternatives[0];
      if (from === to) return null;
    }
    const dist = new Int16Array(GRID * GRID).fill(-1);
    dist[to] = 0;
    const queue = [to];
    for (let head = 0; head < queue.length; head++) {
      const cur = queue[head];
      if (cur === from) break;
      for (const next of this.neighbours(cur)) {
        if (dist[next] !== -1) continue;
        if (!this.fits(state, me, next % GRID, Math.floor(next / GRID), throughBrick)) continue;
        dist[next] = dist[cur] + 1;
        queue.push(next);
      }
    }
    if (dist[from] === -1) return null;
    // Step to whichever neighbour of ours is one closer to the goal.
    const fx = from % GRID;
    const fy = Math.floor(from / GRID);
    let best: Dir | null = null;
    let bestDist = dist[from];
    for (const d of [0, 1, 2, 3] as Dir[]) {
      const [dx, dy] = DIRS[d];
      const nx = fx + dx;
      const ny = fy + dy;
      if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID) continue;
      const nd = dist[ny * GRID + nx];
      if (nd !== -1 && nd < bestDist) {
        bestDist = nd;
        best = d;
      }
    }
    return best;
  }

  private neighbours(idx: number): number[] {
    const x = idx % GRID;
    const y = Math.floor(idx / GRID);
    const out: number[] = [];
    for (const [dx, dy] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < GRID && ny < GRID) out.push(ny * GRID + nx);
    }
    return out;
  }

  /** Any direction that is not into a wall, held for a while so it does not jitter in place. */
  private roam(state: GameState, me: Tank): Dir {
    if (state.tick < this.wanderUntil && !this.blocked(state, me, this.heading)) return this.heading;
    this.wanderUntil = state.tick + 15 + Math.floor(this.rnd() * 25);
    const dirs: Dir[] = [0, 1, 2, 3];
    // Reversing on the spot looks like a stuck bot, so it is the last resort.
    const preferred = dirs.filter((d) => d !== OPPOSITE[this.heading]);
    for (let i = preferred.length - 1; i > 0; i--) {
      const j = Math.floor(this.rnd() * (i + 1));
      [preferred[i], preferred[j]] = [preferred[j], preferred[i]];
    }
    for (const d of preferred) if (!this.blocked(state, me, d)) return d;
    return OPPOSITE[this.heading];
  }

  /** A perpendicular escape when the committed heading has run into something. */
  private sidestep(state: GameState, me: Tank, dir: Dir): Dir {
    const [a, b] = PERPENDICULAR[dir];
    if (!this.blocked(state, me, a)) return a;
    if (!this.blocked(state, me, b)) return b;
    return OPPOSITE[dir];
  }

  /**
   * Whether one step in `dir` is impossible this tick. Deliberately just that — an earlier version
   * also peeked a tile ahead and turned at random, which made the bot dither instead of committing.
   */
  private blocked(state: GameState, me: Tank, dir: Dir): boolean {
    const [dx, dy] = DIRS[dir];
    const nx = me.x + dx * me.speed;
    const ny = me.y + dy * me.speed;
    if (nx < 0 || ny < 0 || nx + TANK_SIZE > FIELD || ny + TANK_SIZE > FIELD) return true;
    return !positionFree(state, me, nx, ny, me.ship);
  }
}
