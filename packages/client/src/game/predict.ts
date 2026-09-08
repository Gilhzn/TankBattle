import { moveTank, PLAYER_SPEED, TankFlag, TICK_MS, TILE, type Dir, type Input, type MoveWorld, type TankDTO, type ViewState } from '@tank/shared';

/** Past this much error (a whole tile) a correction is a teleport — a respawn, a shove — so snap. */
const SNAP_DISTANCE = TILE;
/** Time constant of the visible correction: ~95 % of a small error is absorbed in this long. */
const EASE_TAU_MS = 60;
/** Never run further ahead of the server's known state than this, whatever the link is doing. */
const MAX_LEAD_TICKS = 10;
/** Never replay more than this many ticks in one frame (a stalled stream must not cost a hitch). */
const MAX_REPLAY_TICKS = 24;
/** Inputs older than this are behind every anchor we could still receive. */
const INPUT_HISTORY_TICKS = 90;

const NEUTRAL: Input = { dir: -1, fire: false };

export interface PredictedTank {
  x: number;
  y: number;
  dir: Dir;
  moving: boolean;
}

interface StampedInput extends Input {
  /** Local simulation tick this input became the player's intent. */
  tick: number;
}

/**
 * Runs the local player's own tank ahead of the server.
 *
 * Without this the player's tank is drawn from snapshots like everyone else's, so pressing a
 * direction costs the round trip plus the playout buffer — a quarter to half a second on a mobile
 * link, which is what "the tank feels stuck" means. Here the same `moveTank` the server runs is
 * replayed on the client from the newest authoritative position through the inputs the player has
 * given since, so the tank answers the thumb on the next frame and the server's word still wins.
 *
 * Prediction is re-derived from the anchor every frame rather than integrated, so an error can
 * never accumulate: at worst one frame is wrong and the next is right.
 */
export class Predictor {
  private inputs: StampedInput[] = [{ tick: 0, dir: -1, fire: false }];
  private shown: { x: number; y: number } | null = null;
  private lastDir: Dir = 0;
  /**
   * Reused across frames: prediction runs every frame, and the obstacle list, the world it reads and
   * the tank being placed would otherwise be a fresh set of objects sixty times a second.
   */
  private others: Array<{ x: number; y: number }> = [];
  private world: MoveWorld = { tiles: new Uint8Array(0), tanks: this.others };
  private self = { x: 0, y: 0, dir: 0 as Dir, ship: false };
  /** Tick of the anchor the last prediction started from, for the tests and the debug hook. */
  lastAnchorTick = -1;
  lastPredictTick = -1;

  /** The player changed their intent. `tick` is the local simulation tick it applies from. */
  push(input: Input, tick: number): void {
    const last = this.inputs[this.inputs.length - 1];
    if (last && last.dir === input.dir && last.fire === input.fire) return;
    this.inputs.push({ tick, dir: input.dir, fire: input.fire });
    const cutoff = tick - INPUT_HISTORY_TICKS;
    while (this.inputs.length > 1 && this.inputs[1].tick < cutoff) this.inputs.shift();
  }

  /** The intent that was live at `tick`. Ticks before anything we recorded count as "no input". */
  private inputAt(tick: number): Input {
    let out: Input = NEUTRAL;
    for (const i of this.inputs) {
      if (i.tick > tick) break;
      out = i;
    }
    return out;
  }

  reset(): void {
    this.inputs = [{ tick: 0, dir: -1, fire: false }];
    this.shown = null;
    this.lastAnchorTick = -1;
    this.lastPredictTick = -1;
  }

  /**
   * How far ahead of the server's *known* state the local tank should run: our snapshots are one
   * trip behind and our inputs take another to arrive, so the tick the server will apply the current
   * input on is a whole round trip ahead of the newest tick we know about.
   */
  static leadTicks(rttMs: number): number {
    if (!(rttMs > 0)) return 0;
    return Math.min(MAX_LEAD_TICKS, Math.round(rttMs / TICK_MS));
  }

  /**
   * The position to draw the local tank at. `anchor` is the newest server-sent position for it and
   * the tick that belongs to; `predictTick` is the local simulation tick to reach.
   *
   * Returns null when there is nothing to predict from (no tank, or no anchor yet), in which case
   * the caller falls back to the ordinary interpolated position.
   */
  predict(
    view: ViewState,
    myTank: TankDTO,
    anchor: { tick: number; x: number; y: number },
    predictTick: number,
    frameMs: number,
    speed = PLAYER_SPEED,
  ): PredictedTank | null {
    const id = myTank[0];
    // A tick that jumps backwards is a new match or a stage rewind, not a late packet: the input log
    // is addressed by tick, so it has to go with it.
    if (anchor.tick < this.lastAnchorTick - 8) this.reset();
    const ticks = Math.min(MAX_REPLAY_TICKS, Math.max(0, Math.floor(predictTick) - anchor.tick));
    // Everyone else stands where the last snapshot put them: they are the obstacles, and their own
    // motion inside one replay is far smaller than the tank we are placing.
    const others = this.others;
    let n = 0;
    for (const t of view.tanks as TankDTO[]) {
      if (t[0] === id) continue;
      const slot = others[n] ?? (others[n] = { x: 0, y: 0 });
      slot.x = t[3];
      slot.y = t[4];
      n++;
    }
    others.length = n;
    const world = this.world;
    world.tiles = view.tiles;
    const self = this.self;
    self.x = anchor.x;
    self.y = anchor.y;
    self.dir = myTank[5] as Dir;
    self.ship = (myTank[9] & TankFlag.SHIP) !== 0;

    let moving = false;
    const frozen = view.effects.playerFreeze > 0;
    for (let i = 1; i <= ticks; i++) {
      const input = frozen ? { dir: -1 as const, fire: false } : this.inputAt(anchor.tick + i);
      if (input.dir < 0) {
        moving = false;
        continue;
      }
      moving = moveTank(world, self, input.dir as Dir, speed) > 0;
    }
    this.lastAnchorTick = anchor.tick;
    this.lastPredictTick = anchor.tick + ticks;
    this.lastDir = self.dir;

    // Ease the visible position onto the prediction so a correction reads as the tank being nudged,
    // not as it blinking somewhere else. A big correction is a teleport (respawn, a shove) and is
    // taken at once, because sliding a tank across the arena would be a lie.
    const shown = this.shown;
    if (!shown || Math.abs(shown.x - self.x) > SNAP_DISTANCE || Math.abs(shown.y - self.y) > SNAP_DISTANCE) {
      this.shown = { x: self.x, y: self.y };
    } else {
      const k = 1 - Math.exp(-Math.max(0, frameMs) / EASE_TAU_MS);
      shown.x += (self.x - shown.x) * k;
      shown.y += (self.y - shown.y) * k;
    }
    // The result itself is a fresh object: it is one per frame, and callers do compare the last one
    // with the next.
    return { x: this.shown!.x, y: this.shown!.y, dir: this.lastDir, moving };
  }
}
