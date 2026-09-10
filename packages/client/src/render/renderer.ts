import {
  BASE_TILE_X, BASE_TILE_Y, BULLET_SIZE, FIELD, GRID, POWERUP_SIZE, TANK_SIZE, TILE, TankFlag, Tile,
  type BulletDTO, type PowerUpKind, type TankDTO, type TileId, type ViewState,
} from '@tank/shared';
import type { InterpBuffer } from '../game/interp.js';
import type { Effects } from './effects.js';
import { COLORS, paletteKey, rgba, tankPalette, type Palette } from './theme.js';
import {
  POWERUP_COLORS, SpriteCache, ctxOf, drawBase, drawBulletSprite, drawGlow, drawPlayerMarker, drawPowerUpGlyph, drawTankSprite, drawTile, makeCanvas, roundRect,
  type AnyCanvas,
} from './sprites.js';

export interface RenderOptions {
  mySlot: number;
  reducedMotion: boolean;
  powerUpLabel: (kind: PowerUpKind) => string;
  /** The local player's own tank, simulated ahead of the server so it answers the input at once. */
  local?: { id: number; x: number; y: number; dir: number; moving: boolean } | null;
}

const MAX_DPR = 2;
const HALF_PI = Math.PI / 2;
const TAU = Math.PI * 2;
/**
 * Time constant of the visual hull rotation. The eased angle covers ~95 % of a turn in 110 ms and
 * is visually settled by ~130 ms — the simulation itself stays strictly 4-directional.
 */
const TURN_TAU_MS = 36;

/** Which of `drawTile`'s seven foliage looks a tile has. Mirrors the seed inside `drawTile`. */
function treeSeed(tx: number, ty: number): number {
  return (tx * 73 + ty * 151) % 7;
}

/** Shortest signed angular difference, in (-PI, PI]. */
function angleDelta(from: number, to: number): number {
  return ((((to - from) % TAU) + TAU + Math.PI) % TAU) - Math.PI;
}

/** Canvas 2D renderer. Logical units are simulation sub-pixels (FIELD = 1664) mapped by `scale`. */
export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private sprites = new SpriteCache();
  private tileLayer: AnyCanvas | null = null;
  private tilesCopy = new Uint8Array(GRID * GRID);
  private tilesValid = false;
  private waterTiles: number[] = [];
  /** Tiles carrying foliage, drawn over the tanks from seven cached tile sprites. */
  private treeTiles: number[] = [];
  /** Those seven sprites, by seed, resolved when the map is built so the draw loop only blits. */
  private treeSprites: Array<AnyCanvas | undefined> = [];
  /** Eased render angle per tank id (visual only). Entries are pruned when a tank disappears. */
  private angles = new Map<number, { a: number; seen: number }>();
  private frameSeq = 0;
  private lastTime = 0;
  /** Scratch pairs for entity sampling: the draw loop asks for a position per entity per frame. */
  private posOut = { x: 0, y: 0 };
  private posFallback = { x: 0, y: 0 };
  size = 0; // device px (square)
  scale = 1;
  dpr = 1;

  constructor(readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('canvas 2d unavailable');
    this.ctx = ctx;
  }

  resize(cssSize: number): void {
    const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    const size = Math.max(1, Math.round(cssSize * dpr));
    if (size === this.size && dpr === this.dpr) return;
    this.dpr = dpr;
    this.size = size;
    this.canvas.width = size;
    this.canvas.height = size;
    this.canvas.style.width = `${cssSize}px`;
    this.canvas.style.height = `${cssSize}px`;
    this.scale = size / FIELD;
    this.sprites.clear();
    this.tileLayer = null;
    this.treeSprites = [];
    this.tilesValid = false;
  }

  /**
   * What the renderer is holding, in bytes of canvas backing store — the part of the game's memory
   * that is not JavaScript heap and so does not show up in a heap snapshot.
   */
  memory(): { canvas: number; tiles: number; sprites: number; spriteCount: number; total: number } {
    const area = (c: AnyCanvas | null): number => (c ? c.width * c.height * 4 : 0);
    const canvas = this.size * this.size * 4;
    const tiles = area(this.tileLayer);
    const sprites = this.sprites.bytes;
    return { canvas, tiles, sprites, spriteCount: this.sprites.size, total: canvas + tiles + sprites };
  }

  /** Force the tile layer to rebuild (e.g. after a full snapshot). */
  invalidateTiles(): void {
    this.tilesValid = false;
  }

  private tilesChanged(tiles: Uint8Array): boolean {
    if (!this.tilesValid) return true;
    for (let i = 0; i < tiles.length; i++) if (tiles[i] !== this.tilesCopy[i]) return true;
    return false;
  }

  private rebuildTiles(tiles: Uint8Array): void {
    const size = this.size;
    if (!this.tileLayer) this.tileLayer = makeCanvas(size, size);
    const g = ctxOf(this.tileLayer);
    const ts = TILE * this.scale;
    // ground
    g.fillStyle = COLORS.bg;
    g.fillRect(0, 0, size, size);
    const vg = g.createRadialGradient(size / 2, size / 2, size * 0.1, size / 2, size / 2, size * 0.8);
    vg.addColorStop(0, 'rgba(20, 28, 52, 0.55)');
    vg.addColorStop(1, 'rgba(7, 9, 15, 0)');
    g.fillStyle = vg;
    g.fillRect(0, 0, size, size);
    g.strokeStyle = COLORS.grid;
    g.lineWidth = 1;
    g.beginPath();
    for (let i = 0; i <= GRID; i++) {
      const p = Math.round(i * ts) + 0.5;
      g.moveTo(p, 0);
      g.lineTo(p, size);
      g.moveTo(0, p);
      g.lineTo(size, p);
    }
    g.stroke();
    g.strokeStyle = 'rgba(94, 225, 255, 0.09)';
    g.beginPath();
    for (let i = 0; i <= GRID; i += 2) {
      const p = Math.round(i * ts) + 0.5;
      g.moveTo(p, 0);
      g.lineTo(p, size);
      g.moveTo(0, p);
      g.lineTo(size, p);
    }
    g.stroke();

    this.waterTiles = [];
    this.treeTiles = [];
    this.treeSprites = [];
    const treePx = Math.ceil(ts);
    for (let ty = 0; ty < GRID; ty++) {
      for (let tx = 0; tx < GRID; tx++) {
        const i = ty * GRID + tx;
        const t = tiles[i] as TileId;
        const x = tx * ts;
        const y = ty * ts;
        if (t === Tile.BASE || t === Tile.BASE_DEAD) {
          if (tx === BASE_TILE_X && ty === BASE_TILE_Y) drawBase(g, x, y, ts * 2, t === Tile.BASE_DEAD);
          continue;
        }
        // Foliage is drawn over the tanks each frame, from a sprite per look — a whole second
        // full-screen buffer for a handful of tiles is memory the game never needed.
        if (t === Tile.TREES) {
          this.treeTiles.push(i);
          // `drawTile` gives the tile one of seven looks from its coordinates; resolve each look
          // once here so the per-frame pass is a blit and nothing else.
          const seed = treeSeed(tx, ty);
          if (!this.treeSprites[seed]) {
            this.treeSprites[seed] = this.sprites.get(`trees|${seed}`, treePx, treePx, (c) => drawTile(c, Tile.TREES, 0, 0, ts, tx, ty));
          }
          continue;
        }
        if (t === Tile.WATER) this.waterTiles.push(i);
        drawTile(g, t, x, y, ts, tx, ty);
      }
    }
    this.tilesCopy.set(tiles);
    this.tilesValid = true;
  }

  /** The canopy, over the tanks: one blit per foliage tile, from the seven sprites built with the map. */
  private drawTrees(): void {
    if (!this.treeTiles.length) return;
    const ctx = this.ctx;
    const ts = TILE * this.scale;
    ctx.save();
    ctx.globalAlpha = 0.88;
    for (const i of this.treeTiles) {
      const tx = i % GRID;
      const ty = (i - tx) / GRID;
      const sprite = this.treeSprites[treeSeed(tx, ty)];
      if (sprite) ctx.drawImage(sprite, tx * ts, ty * ts);
    }
    ctx.restore();
  }

  /** Pulses running along the plasma channel: two travelling bands per tile, phase-offset per tile. */
  private drawWater(time: number): void {
    if (!this.waterTiles.length) return;
    const ctx = this.ctx;
    const ts = TILE * this.scale;
    const phase = (time / 900) % 1;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const i of this.waterTiles) {
      const tx = i % GRID;
      const ty = (i - tx) / GRID;
      const x = tx * ts;
      const y = ty * ts;
      const off = ((phase + ((tx + ty) % 4) * 0.25) % 1) * ts;
      // The bright pulse rides the core band, not the whole tile: the lip of the trench stays dark.
      ctx.fillStyle = rgba(COLORS.plasmaCore, 0.3);
      ctx.fillRect(x, y + off, ts, Math.max(1, ts * 0.1));
      ctx.fillStyle = rgba(COLORS.waterGlow, 0.12);
      ctx.fillRect(x, y + ((off + ts * 0.5) % ts), ts, Math.max(1, ts * 0.06));
    }
    ctx.restore();
  }

  private tankSprite(palette: Palette, isPlayer: boolean, frame: number, tier: number): AnyCanvas {
    const bodyPx = TANK_SIZE * this.scale;
    const size = Math.ceil(bodyPx / 0.8);
    const key = `tank|${paletteKey(palette)}|${frame}|${tier}|${isPlayer ? 1 : 0}`;
    return this.sprites.get(key, size, size, (c, w) => drawTankSprite(c, w, { palette, frame, tier, isPlayer }));
  }

  /**
   * Eased hull angle for a tank. The logical facing snaps (the sim is 4-directional); the drawn
   * angle chases it the short way round so a turn reads as the hull rotating.
   */
  private tankAngle(id: number, dir: number, dt: number, reduced: boolean): number {
    const target = dir * HALF_PI;
    let e = this.angles.get(id);
    if (!e) {
      e = { a: target, seen: this.frameSeq };
      this.angles.set(id, e);
      return target;
    }
    e.seen = this.frameSeq;
    if (reduced || dt <= 0) {
      e.a = target;
      return target;
    }
    const d = angleDelta(e.a, target);
    if (Math.abs(d) < 0.002) e.a = target;
    else e.a += d * (1 - Math.exp(-dt / TURN_TAU_MS));
    e.a = ((e.a % TAU) + TAU) % TAU;
    return e.a;
  }

  /** Drops angle state for tanks that were not drawn this frame, so the map cannot grow unbounded. */
  private pruneAngles(): void {
    for (const [id, e] of this.angles) if (e.seen !== this.frameSeq) this.angles.delete(id);
  }

  private drawTanks(view: ViewState, interp: InterpBuffer, rt: number, time: number, dt: number, opts: RenderOptions): void {
    const ctx = this.ctx;
    const s = this.scale;
    const half = (TANK_SIZE * s) / 2;
    for (const t of view.tanks as TankDTO[]) {
      const [id, owner, kind, tx, ty, dir, tier, hp, maxHp, flags, skin] = t;
      // The local player's tank is drawn from the prediction; everyone else from the playout buffer.
      const local = opts.local && opts.local.id === id ? opts.local : null;
      this.posFallback.x = tx;
      this.posFallback.y = ty;
      const pos = local ?? interp.tankPos(id, rt, this.posFallback, this.posOut);
      const cx = pos.x * s + half;
      const cy = pos.y * s + half;
      const spawning = (flags & TankFlag.SPAWNING) !== 0;
      ctx.save();
      ctx.translate(cx, cy);
      if (spawning) {
        this.drawSpawnStar(time, half);
        ctx.restore();
        continue;
      }
      const isPlayer = kind === 'player';
      const moving = local ? local.moving : (flags & TankFlag.MOVING) !== 0;
      const frame = moving ? Math.floor(time / 90) % 2 : 0;
      const palette = tankPalette(kind, owner, skin, hp, maxHp);
      const sprite = this.tankSprite(palette, isPlayer, frame, isPlayer ? tier : 0);
      const sw = sprite.width;
      ctx.save();
      ctx.rotate(this.tankAngle(id, local ? local.dir : dir, dt, opts.reducedMotion));
      ctx.drawImage(sprite, -sw / 2, -sw / 2);
      ctx.restore();
      if (isPlayer) drawPlayerMarker(ctx, half, palette.glow, owner === opts.mySlot);
      if (flags & TankFlag.FROZEN) {
        ctx.fillStyle = rgba(COLORS.cyan, 0.32);
        roundRect(ctx, -half, -half, half * 2, half * 2, half * 0.3);
        ctx.fill();
      }
      if (flags & TankFlag.FLASHING) {
        const a = 0.45 + 0.45 * Math.sin(time / 80);
        ctx.strokeStyle = `rgba(255,255,255,${a})`;
        ctx.lineWidth = Math.max(1.5, 3 * s);
        roundRect(ctx, -half - 2 * s, -half - 2 * s, half * 2 + 4 * s, half * 2 + 4 * s, half * 0.35);
        ctx.stroke();
      }
      if (flags & TankFlag.SHIP) {
        ctx.strokeStyle = rgba('#7fb2ff', 0.8);
        ctx.lineWidth = Math.max(1, 2.5 * s);
        ctx.beginPath();
        ctx.arc(0, 0, half * 1.05, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (flags & TankFlag.SHIELD) this.drawShield(time, half, isPlayer ? COLORS.cyan : COLORS.lime);
      ctx.restore();
    }
    this.pruneAngles();
  }

  private drawSpawnStar(time: number, half: number): void {
    const ctx = this.ctx;
    const size = Math.ceil(half * 2.6);
    const star = this.sprites.get('spawnstar', size, size, (c, w) => {
      drawGlow(c, w, COLORS.cyan, 0.5);
      const cx = w / 2;
      c.fillStyle = COLORS.white;
      c.beginPath();
      for (let i = 0; i < 8; i++) {
        const r = i % 2 === 0 ? w * 0.42 : w * 0.12;
        const a = (i * Math.PI) / 4;
        c.lineTo(cx + Math.cos(a) * r, cx + Math.sin(a) * r);
      }
      c.closePath();
      c.fill();
    });
    const pulse = 0.75 + 0.25 * Math.sin(time / 70);
    ctx.save();
    ctx.rotate(time / 250);
    ctx.scale(pulse, pulse);
    ctx.globalAlpha = 0.85;
    ctx.drawImage(star, -size / 2, -size / 2);
    ctx.restore();
  }

  private drawShield(time: number, half: number, color: string): void {
    const ctx = this.ctx;
    const size = Math.ceil(half * 3);
    const ring = this.sprites.get(`hex|${color}`, size, size, (c, w) => {
      const cx = w / 2;
      const r = w * 0.4;
      c.strokeStyle = rgba(color, 0.18);
      c.lineWidth = Math.max(2, w * 0.09);
      hexPath(c, cx, cx, r);
      c.stroke();
      c.strokeStyle = rgba(color, 0.95);
      c.lineWidth = Math.max(1, w * 0.035);
      hexPath(c, cx, cx, r);
      c.stroke();
    });
    ctx.save();
    ctx.rotate(time / 600);
    ctx.globalAlpha = 0.8 + 0.2 * Math.sin(time / 120);
    ctx.drawImage(ring, -size / 2, -size / 2);
    ctx.restore();
  }

  private drawBullets(view: ViewState, interp: InterpBuffer, rt: number): void {
    const ctx = this.ctx;
    const s = this.scale;
    const half = (BULLET_SIZE * s) / 2;
    const size = Math.ceil(BULLET_SIZE * s * 3.2);
    const playerSprite = this.sprites.get('bullet|p', size, size, (c, w) => drawBulletSprite(c, w, COLORS.bulletPlayer, COLORS.amber));
    const enemySprite = this.sprites.get('bullet|e', size, size, (c, w) => drawBulletSprite(c, w, COLORS.bulletEnemy, COLORS.magenta));
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const b of view.bullets as BulletDTO[]) {
      const [id, bx, by, dir, fromPlayer] = b;
      this.posFallback.x = bx;
      this.posFallback.y = by;
      const pos = interp.bulletPos(id, rt, this.posFallback, this.posOut);
      const cx = pos.x * s + half;
      const cy = pos.y * s + half;
      const dx = dir === 1 ? -1 : dir === 3 ? 1 : 0;
      const dy = dir === 2 ? -1 : dir === 0 ? 1 : 0;
      const len = 60 * s;
      const grad = ctx.createLinearGradient(cx, cy, cx + dx * len, cy + dy * len);
      grad.addColorStop(0, rgba(fromPlayer ? COLORS.amber : COLORS.magenta, 0.75));
      grad.addColorStop(1, rgba(fromPlayer ? COLORS.amber : COLORS.magenta, 0));
      ctx.strokeStyle = grad;
      ctx.lineWidth = Math.max(1.5, half * 1.2);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + dx * len, cy + dy * len);
      ctx.stroke();
      ctx.drawImage(fromPlayer ? playerSprite : enemySprite, cx - size / 2, cy - size / 2);
    }
    ctx.restore();
  }

  private drawPowerUp(view: ViewState, time: number, label: (k: PowerUpKind) => string): void {
    const pu = view.powerUp;
    if (!pu) return;
    const ctx = this.ctx;
    const s = this.scale;
    const box = POWERUP_SIZE * s;
    const cx = pu.x * s + box / 2;
    const cy = pu.y * s + box / 2;
    const color = POWERUP_COLORS[pu.kind];
    const glowSize = Math.ceil(box * 2.2);
    const glow = this.sprites.get(`puglow|${color}`, glowSize, glowSize, (c, w) => drawGlow(c, w, color, 0.5));
    const glyphSize = Math.ceil(box * 0.78);
    const glyph = this.sprites.get(`pu|${pu.kind}`, glyphSize, glyphSize, (c, w) => drawPowerUpGlyph(c, pu.kind, w, color));
    const pulse = 1 + 0.07 * Math.sin(time / 160);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.globalAlpha = 0.7 + 0.3 * Math.sin(time / 200);
    ctx.drawImage(glow, -glowSize / 2, -glowSize / 2);
    ctx.globalAlpha = 1;
    ctx.scale(pulse, pulse);
    roundRect(ctx, -box * 0.46, -box * 0.46, box * 0.92, box * 0.92, box * 0.22);
    ctx.fillStyle = 'rgba(10, 14, 28, 0.85)';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, box * 0.06);
    ctx.stroke();
    ctx.drawImage(glyph, -glyphSize / 2, -glyphSize / 2);
    ctx.restore();
    ctx.save();
    ctx.font = `700 ${Math.max(9, box * 0.36)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    const text = label(pu.kind).toUpperCase();
    ctx.fillText(text, cx + 1, cy + box * 0.55 + 1);
    ctx.fillStyle = color;
    ctx.fillText(text, cx, cy + box * 0.55);
    ctx.restore();
  }

  draw(view: ViewState, interp: InterpBuffer, effects: Effects, time: number, opts: RenderOptions): void {
    if (!this.size) return;
    const ctx = this.ctx;
    const size = this.size;
    if (this.tilesChanged(view.tiles)) this.rebuildTiles(view.tiles);
    const rt = interp.renderTick(time);
    const dt = this.lastTime ? Math.min(120, Math.max(0, time - this.lastTime)) : 0;
    this.lastTime = time;
    this.frameSeq++;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, size, size);
    const [sx, sy] = opts.reducedMotion ? [0, 0] : effects.shakeOffset();
    ctx.translate(sx * this.dpr, sy * this.dpr);

    if (this.tileLayer) ctx.drawImage(this.tileLayer, 0, 0);
    this.drawWater(time);
    this.drawTanks(view, interp, rt, time, dt, opts);
    this.drawBullets(view, interp, rt);
    effects.draw(ctx, this.scale, Math.max(10, TILE * this.scale * 0.7));
    this.drawTrees();
    this.drawPowerUp(view, time, opts.powerUpLabel);

    if (view.effects.freeze > 0) {
      ctx.fillStyle = rgba(COLORS.cyan, 0.07 + 0.03 * Math.sin(time / 300));
      ctx.fillRect(-8, -8, size + 16, size + 16);
    }
    if (view.effects.playerFreeze > 0) {
      ctx.fillStyle = rgba(COLORS.magenta, 0.07);
      ctx.fillRect(-8, -8, size + 16, size + 16);
    }
    if (effects.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${effects.flash * 0.6})`;
      ctx.fillRect(-8, -8, size + 16, size + 16);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
}

function hexPath(c: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  c.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    c.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  c.closePath();
}
