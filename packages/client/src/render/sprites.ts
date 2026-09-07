import { Tile, type PowerUpKind, type TileId } from '@tank/shared';
import { COLORS, rgba, type Palette } from './theme.js';

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

export function makeCanvas(w: number, h: number): AnyCanvas {
  const W = Math.max(1, Math.ceil(w));
  const H = Math.max(1, Math.ceil(h));
  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      return new OffscreenCanvas(W, H);
    } catch {
      /* fall through */
    }
  }
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  return c;
}

export function ctxOf(c: AnyCanvas): Ctx2D {
  const ctx = (c as HTMLCanvasElement).getContext('2d') as Ctx2D | null;
  if (!ctx) throw new Error('2d context unavailable');
  return ctx;
}

/** Keyed cache of pre-rendered sprites (OffscreenCanvas when available). Glows are baked here, never blurred per frame. */
export class SpriteCache {
  private map = new Map<string, AnyCanvas>();
  get(key: string, w: number, h: number, draw: (ctx: Ctx2D, w: number, h: number) => void): AnyCanvas {
    let c = this.map.get(key);
    if (!c) {
      c = makeCanvas(w, h);
      draw(ctxOf(c), w, h);
      this.map.set(key, c);
    }
    return c;
  }
  clear(): void {
    this.map.clear();
  }
  get size(): number {
    return this.map.size;
  }
}

export function roundRect(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

/** Radial glow disc, drawn once per (color, size). */
export function drawGlow(ctx: Ctx2D, size: number, color: string, inner = 0.9): void {
  const r = size / 2;
  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, rgba(color, inner));
  g.addColorStop(0.35, rgba(color, inner * 0.45));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
}

export interface TankSpriteOptions {
  palette: Palette;
  frame: number; // 0/1 tread animation
  tier: number;
  isPlayer: boolean;
}

/**
 * Draws a tank facing UP into a (size x size) canvas. `size` includes a 25 % glow margin around the body.
 * Body occupies the centre 80 %.
 */
export function drawTankSprite(ctx: Ctx2D, size: number, o: TankSpriteOptions): void {
  const m = size * 0.1; // margin
  const body = size - m * 2;
  const u = body / 16; // 16 logical px
  const { primary, secondary, glow } = o.palette;
  ctx.save();
  ctx.translate(m, m);

  // glow halo (baked)
  const gg = ctx.createRadialGradient(body / 2, body / 2, body * 0.3, body / 2, body / 2, body * 0.72);
  gg.addColorStop(0, rgba(glow, o.isPlayer ? 0.35 : 0.22));
  gg.addColorStop(1, rgba(glow, 0));
  ctx.fillStyle = gg;
  ctx.fillRect(-m, -m, size, size);

  // tracks
  const trackW = u * 3.4;
  for (const tx of [0, body - trackW]) {
    roundRect(ctx, tx, u * 1, trackW, body - u * 2, u * 1.2);
    ctx.fillStyle = '#1b2130';
    ctx.fill();
    ctx.strokeStyle = rgba(glow, 0.55);
    ctx.lineWidth = Math.max(1, u * 0.35);
    ctx.stroke();
    // treads
    ctx.fillStyle = rgba(glow, 0.5);
    const step = u * 1.6;
    for (let y = u * 1.4 + (o.frame ? step / 2 : 0); y < body - u * 1.6; y += step) {
      ctx.fillRect(tx + u * 0.5, y, trackW - u, u * 0.55);
    }
  }

  // hull
  const hx = trackW - u * 0.6;
  const hw = body - hx * 2;
  const hg = ctx.createLinearGradient(0, u * 2, 0, body - u * 2);
  hg.addColorStop(0, primary);
  hg.addColorStop(1, secondary);
  roundRect(ctx, hx, u * 2.2, hw, body - u * 4.4, u * 2);
  ctx.fillStyle = hg;
  ctx.fill();
  ctx.strokeStyle = rgba('#ffffff', 0.25);
  ctx.lineWidth = Math.max(1, u * 0.3);
  ctx.stroke();

  // turret
  const cx = body / 2;
  const cy = body / 2 + u * 0.8;
  ctx.beginPath();
  ctx.arc(cx, cy, u * 3.1, 0, Math.PI * 2);
  ctx.fillStyle = secondary;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, u * 2.2, 0, Math.PI * 2);
  ctx.fillStyle = primary;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx - u * 0.6, cy - u * 0.6, u * 0.9, 0, Math.PI * 2);
  ctx.fillStyle = rgba('#ffffff', 0.5);
  ctx.fill();

  // barrel(s)
  const barrelW = u * (o.tier >= 3 ? 2.2 : o.tier >= 1 ? 1.8 : 1.4);
  const barrelLen = cy - u * 0.2;
  const drawBarrel = (bx: number): void => {
    roundRect(ctx, bx - barrelW / 2, u * 0.2, barrelW, barrelLen, barrelW / 2);
    ctx.fillStyle = secondary;
    ctx.fill();
    ctx.fillStyle = rgba(glow, 0.9);
    ctx.fillRect(bx - barrelW / 2 + u * 0.3, u * 0.2, barrelW * 0.35, barrelLen - u * 1.5);
  };
  if (o.tier >= 2) {
    drawBarrel(cx - u * 1.5);
    drawBarrel(cx + u * 1.5);
  } else drawBarrel(cx);
  if (o.tier >= 3) {
    ctx.fillStyle = rgba(glow, 0.9);
    ctx.fillRect(hx + u * 0.4, body - u * 4.5, hw - u * 0.8, u * 0.7);
  }
  ctx.restore();
}

export function drawBulletSprite(ctx: Ctx2D, size: number, color: string, glow: string): void {
  drawGlow(ctx, size, glow, 0.8);
  const r = size / 2;
  ctx.beginPath();
  ctx.arc(r, r, size * 0.16, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

/** Static tiles. `s` is the tile size in device px. */
export function drawTile(ctx: Ctx2D, tile: TileId, x: number, y: number, s: number, tx: number, ty: number): void {
  switch (tile) {
    case Tile.BRICK: {
      ctx.fillStyle = COLORS.mortar;
      ctx.fillRect(x, y, s, s);
      const bw = s / 2;
      const bh = s / 2;
      const gap = Math.max(0.6, s * 0.08);
      for (let r = 0; r < 2; r++) {
        const off = (r + ty) % 2 === 0 ? 0 : bw / 2;
        for (let c = -1; c < 3; c++) {
          const bx = x + c * bw + off;
          const by = y + r * bh;
          const cx0 = Math.max(bx + gap / 2, x);
          const cx1 = Math.min(bx + bw - gap / 2, x + s);
          if (cx1 <= cx0) continue;
          const g = ctx.createLinearGradient(0, by, 0, by + bh);
          g.addColorStop(0, COLORS.brickLight);
          g.addColorStop(1, COLORS.brick);
          ctx.fillStyle = g;
          ctx.fillRect(cx0, by + gap / 2, cx1 - cx0, bh - gap);
        }
      }
      break;
    }
    case Tile.STEEL: {
      const g = ctx.createLinearGradient(x, y, x + s, y + s);
      g.addColorStop(0, COLORS.steelLight);
      g.addColorStop(0.5, COLORS.steel);
      g.addColorStop(1, COLORS.steelDark);
      ctx.fillStyle = g;
      ctx.fillRect(x, y, s, s);
      ctx.fillStyle = COLORS.steelDark;
      ctx.fillRect(x + s * 0.28, y + s * 0.28, s * 0.44, s * 0.44);
      ctx.fillStyle = rgba(COLORS.cyan, 0.35);
      ctx.fillRect(x + s * 0.34, y + s * 0.34, s * 0.32, s * 0.32);
      ctx.strokeStyle = rgba('#000000', 0.5);
      ctx.lineWidth = Math.max(0.5, s * 0.06);
      ctx.strokeRect(x + ctx.lineWidth / 2, y + ctx.lineWidth / 2, s - ctx.lineWidth, s - ctx.lineWidth);
      break;
    }
    case Tile.ICE: {
      ctx.fillStyle = rgba(COLORS.ice, 0.22);
      ctx.fillRect(x, y, s, s);
      ctx.strokeStyle = rgba(COLORS.ice, 0.35);
      ctx.lineWidth = Math.max(0.5, s * 0.05);
      ctx.beginPath();
      ctx.moveTo(x + s * 0.15, y + s * 0.7);
      ctx.lineTo(x + s * 0.55, y + s * 0.3);
      ctx.moveTo(x + s * 0.5, y + s * 0.85);
      ctx.lineTo(x + s * 0.85, y + s * 0.5);
      ctx.stroke();
      break;
    }
    case Tile.WATER: {
      const g = ctx.createLinearGradient(x, y, x, y + s);
      g.addColorStop(0, COLORS.water);
      g.addColorStop(1, '#072744');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, s, s);
      break;
    }
    case Tile.TREES: {
      // overlay layer: neon foliage clusters
      const seed = (tx * 73 + ty * 151) % 7;
      ctx.fillStyle = rgba(COLORS.treesDark, 0.55);
      ctx.fillRect(x, y, s, s);
      const blobs = [
        [0.3, 0.3, 0.32],
        [0.7, 0.35, 0.3],
        [0.45, 0.7, 0.34],
        [0.8, 0.75, 0.24],
        [0.18, 0.72, 0.22],
      ];
      for (let i = 0; i < blobs.length; i++) {
        const [bx, by, br] = blobs[(i + seed) % blobs.length];
        ctx.beginPath();
        ctx.arc(x + bx * s, y + by * s, br * s, 0, Math.PI * 2);
        ctx.fillStyle = i % 2 === 0 ? rgba(COLORS.trees, 0.75) : rgba(COLORS.treesLight, 0.6);
        ctx.fill();
      }
      break;
    }
    default:
      break;
  }
}

/** The base emblem occupies a 2x2 tile block. `s` is the block size in device px. */
export function drawBase(ctx: Ctx2D, x: number, y: number, s: number, dead: boolean): void {
  const u = s / 16;
  ctx.save();
  ctx.translate(x, y);
  // pedestal
  roundRect(ctx, u * 1, u * 1, s - u * 2, s - u * 2, u * 2);
  ctx.fillStyle = dead ? '#2a2323' : '#141a2b';
  ctx.fill();
  ctx.strokeStyle = dead ? rgba('#ff5e5e', 0.5) : rgba(COLORS.amber, 0.7);
  ctx.lineWidth = Math.max(1, u * 0.5);
  ctx.stroke();
  if (dead) {
    ctx.strokeStyle = rgba('#ff7b7b', 0.7);
    ctx.lineWidth = Math.max(1, u * 0.6);
    ctx.beginPath();
    ctx.moveTo(u * 4, u * 4);
    ctx.lineTo(u * 12, u * 12);
    ctx.moveTo(u * 12, u * 4);
    ctx.lineTo(u * 4, u * 12);
    ctx.stroke();
    ctx.restore();
    return;
  }
  // eagle-like emblem: wings + body
  const cx = s / 2;
  ctx.fillStyle = COLORS.base;
  ctx.beginPath();
  ctx.moveTo(cx, u * 3);
  ctx.lineTo(cx + u * 5.5, u * 6);
  ctx.lineTo(cx + u * 3.5, u * 7.5);
  ctx.lineTo(cx + u * 2, u * 12.5);
  ctx.lineTo(cx - u * 2, u * 12.5);
  ctx.lineTo(cx - u * 3.5, u * 7.5);
  ctx.lineTo(cx - u * 5.5, u * 6);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = COLORS.baseDark;
  ctx.beginPath();
  ctx.arc(cx, u * 6.5, u * 1.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = rgba(COLORS.magenta, 0.9);
  ctx.beginPath();
  ctx.arc(cx, u * 9.5, u * 1.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export const POWERUP_COLORS: Record<PowerUpKind, string> = {
  star: COLORS.amber,
  tank: COLORS.lime,
  grenade: COLORS.magenta,
  clock: COLORS.cyan,
  shovel: '#c9d2e3',
  helmet: COLORS.cyan,
  ship: '#7fb2ff',
  gun: '#ff8a5e',
};

/** Vector glyph for a power-up kind, centred in a (size x size) box. */
export function drawPowerUpGlyph(ctx: Ctx2D, kind: PowerUpKind, size: number, color: string): void {
  const c = size / 2;
  const u = size / 16;
  ctx.save();
  ctx.translate(c, c);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, u * 1.2);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  switch (kind) {
    case 'star': {
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? u * 5.5 : u * 2.4;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'tank': {
      roundRect(ctx, -u * 4, -u * 3, u * 8, u * 6, u);
      ctx.fill();
      ctx.fillRect(-u * 1, -u * 6.5, u * 2, u * 4);
      ctx.fillStyle = rgba('#000', 0.35);
      ctx.fillRect(-u * 4, -u * 3, u * 1.6, u * 6);
      ctx.fillRect(u * 2.4, -u * 3, u * 1.6, u * 6);
      break;
    }
    case 'grenade': {
      ctx.beginPath();
      ctx.arc(0, u * 1, u * 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(-u * 1.5, -u * 6, u * 3, u * 2.5);
      ctx.beginPath();
      ctx.arc(u * 3, -u * 5, u * 1.5, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'clock': {
      ctx.beginPath();
      ctx.arc(0, 0, u * 5.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -u * 3.5);
      ctx.lineTo(0, 0);
      ctx.lineTo(u * 2.5, u * 1.5);
      ctx.stroke();
      break;
    }
    case 'shovel': {
      ctx.beginPath();
      ctx.moveTo(-u * 3, -u * 6);
      ctx.lineTo(u * 3, 0);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(u * 1, u * 1);
      ctx.lineTo(u * 5, -u * 1);
      ctx.lineTo(u * 6, u * 4);
      ctx.lineTo(u * 2, u * 6);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'helmet': {
      ctx.beginPath();
      ctx.arc(0, u * 1, u * 5.5, Math.PI, 0);
      ctx.lineTo(u * 5.5, u * 3);
      ctx.lineTo(-u * 5.5, u * 3);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = rgba('#000', 0.35);
      ctx.fillRect(-u * 5.5, u * 1, u * 11, u * 1);
      break;
    }
    case 'ship': {
      ctx.beginPath();
      ctx.moveTo(-u * 6, u * 1);
      ctx.lineTo(u * 6, u * 1);
      ctx.lineTo(u * 4, u * 4.5);
      ctx.lineTo(-u * 4, u * 4.5);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(-u * 0.8, -u * 6, u * 1.6, u * 7);
      ctx.beginPath();
      ctx.moveTo(u * 0.8, -u * 5.5);
      ctx.lineTo(u * 5, -u * 2);
      ctx.lineTo(u * 0.8, -u * 1);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'gun': {
      roundRect(ctx, -u * 6, -u * 1.2, u * 12, u * 2.4, u);
      ctx.fill();
      ctx.fillRect(-u * 6, -u * 2.4, u * 3, u * 4.8);
      ctx.fillRect(u * 3, -u * 1.9, u * 3, u * 3.8);
      break;
    }
  }
  ctx.restore();
}
