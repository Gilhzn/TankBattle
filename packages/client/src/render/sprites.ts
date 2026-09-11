import { Tile, type PowerUpKind, type TankShape, type TileId } from '@tank/shared';
import { COLORS, LIGHT, mixHex, rgba, shade, type Palette } from './theme.js';

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
  /** Backing-store bytes held by the cache (4 bytes per pixel), for the memory diagnostics. */
  get bytes(): number {
    let n = 0;
    for (const c of this.map.values()) n += c.width * c.height * 4;
    return n;
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
  /** Overrides `palette.shape`. Defaults to the palette's shape, then 'standard'. */
  shape?: TankShape;
}

/* ------------------------------------------------------------------ *
 * Chassis geometry. Every value is in "u" = 1/16 of the 16x16 logical
 * tank box, with the tank facing UP (barrel towards y = 0). No shape
 * may put ink outside 0..16 on either axis, so silhouettes differ
 * without any chassis growing past the collision box.
 * ------------------------------------------------------------------ */

type Pt = [number, number];

interface Chassis {
  /** Track pods: [x, y0, y1] triples get mirrored to the right side. */
  trackW: number;
  trackR: number;
  /** Vertical spans of the track on one side; two spans = split pods. */
  trackSpans: Array<[number, number]>;
  treadStep: number;
  treadH: number;
  /** Armoured side skirt drawn over the tracks. */
  skirt: boolean;
  /** Hull outline; `null` uses a rounded rect from hullRect. */
  hull: Pt[] | null;
  hullRect?: [number, number, number, number, number]; // x, y, w, h, r
  turret: 'round' | 'hex' | 'box' | 'wedge';
  turretR: number;
  turretY: number;
  barrelW: number;
  barrelTip: number;
  muzzle: 'none' | 'brake' | 'fork' | 'flare' | 'ring';
  extras: 'none' | 'glacis' | 'wings' | 'stacks' | 'bands' | 'deck' | 'vents';
  cupola: boolean;
  antenna: boolean;
}

const CHASSIS: Record<TankShape, Chassis> = {
  // Free / ally chassis. Angular, with chamfered shoulders and a hexagonal turret ring: it has to
  // hold its own next to the paid hulls without borrowing any of their tells.
  standard: {
    trackW: 3.2, trackR: 0.9, trackSpans: [[1.2, 14.8]], treadStep: 1.5, treadH: 0.6, skirt: false,
    hull: [[5.4, 1.6], [10.6, 1.6], [12.3, 4.4], [12.3, 11.8], [10.6, 14.4], [5.4, 14.4], [3.7, 11.8], [3.7, 4.4]],
    turret: 'hex', turretR: 3.0, turretY: 9.0,
    barrelW: 1.5, barrelTip: 0.2, muzzle: 'none', extras: 'none', cupola: false, antenna: false,
  },
  // 400 gems — very wide tracks, narrow blocky hull, stubby high-calibre gun.
  heavy: {
    trackW: 4.5, trackR: 0.5, trackSpans: [[0.5, 15.5]], treadStep: 1.3, treadH: 0.8, skirt: false,
    hull: [[5.3, 1.6], [10.7, 1.6], [12.1, 3.0], [12.1, 13.0], [10.7, 14.4], [5.3, 14.4], [3.9, 13.0], [3.9, 3.0]],
    turret: 'box', turretR: 3.2, turretY: 8.1,
    barrelW: 2.7, barrelTip: 2.3, muzzle: 'ring', extras: 'glacis', cupola: false, antenna: false,
  },
  // 300 gems — thin short tracks, arrowhead wedge hull.
  stealth: {
    trackW: 2.4, trackR: 1.0, trackSpans: [[3.0, 13.4]], treadStep: 1.5, treadH: 0.45, skirt: false,
    hull: [[8, 0.9], [12.7, 5.2], [12.0, 13.2], [9.6, 14.6], [6.4, 14.6], [4.0, 13.2], [3.3, 5.2]],
    turret: 'wedge', turretR: 2.9, turretY: 9.5,
    barrelW: 1.3, barrelTip: 0.2, muzzle: 'none', extras: 'vents', cupola: false, antenna: false,
  },
  // 600 gems — split track pods, notched faceted hull, swept fins, forked muzzle.
  phantom: {
    trackW: 2.3, trackR: 1.0, trackSpans: [[1.8, 6.9], [9.1, 14.2]], treadStep: 1.4, treadH: 0.5, skirt: false,
    hull: [[8, 1.3], [11.6, 4.0], [12.5, 9.0], [10.9, 14.4], [9.0, 12.9], [7.0, 12.9], [5.1, 14.4], [3.5, 9.0], [4.4, 4.0]],
    turret: 'hex', turretR: 2.8, turretY: 9.6,
    barrelW: 1.4, barrelTip: 0.3, muzzle: 'fork', extras: 'wings', cupola: false, antenna: true,
  },
  // 800 gems — skirted tracks, chamfered hull, cupola, long barrel with a muzzle brake.
  elite: {
    trackW: 3.3, trackR: 0.6, trackSpans: [[1.2, 14.8]], treadStep: 1.5, treadH: 0.55, skirt: true,
    hull: [[6.6, 1.3], [9.4, 1.3], [12.2, 4.6], [12.2, 11.6], [10.6, 14.5], [5.4, 14.5], [3.8, 11.6], [3.8, 4.6]],
    turret: 'round', turretR: 3.1, turretY: 10.6,
    barrelW: 1.8, barrelTip: 0.1, muzzle: 'brake', extras: 'deck', cupola: true, antenna: true,
  },
  // ---- AI chassis: squat, riveted, never a player silhouette ----
  grunt: {
    trackW: 3.2, trackR: 0.4, trackSpans: [[1.2, 14.8]], treadStep: 1.5, treadH: 0.7, skirt: false,
    hull: null, hullRect: [3.5, 2.6, 9.0, 10.8, 0.8],
    turret: 'box', turretR: 2.7, turretY: 8.6,
    barrelW: 1.5, barrelTip: 1.5, muzzle: 'none', extras: 'bands', cupola: false, antenna: false,
  },
  scout: {
    trackW: 2.7, trackR: 1.3, trackSpans: [[2.0, 14.0]], treadStep: 1.2, treadH: 0.45, skirt: false,
    hull: [[8, 2.0], [11.3, 4.8], [11.3, 12.2], [4.7, 12.2], [4.7, 4.8]],
    turret: 'round', turretR: 2.3, turretY: 8.3,
    barrelW: 1.2, barrelTip: 0.9, muzzle: 'none', extras: 'stacks', cupola: false, antenna: false,
  },
  // Gun platform: narrow tracks, sharply pointed nose, hex turret with a cupola and a long
  // flared cannon that overhangs the hull. Reads as "all barrel".
  brute: {
    trackW: 3.4, trackR: 0.5, trackSpans: [[1.6, 14.4]], treadStep: 1.4, treadH: 0.7, skirt: false,
    hull: [[4.6, 3.6], [8, 1.4], [11.4, 3.6], [12.6, 5.2], [12.6, 13.7], [3.4, 13.7], [3.4, 5.2]],
    turret: 'hex', turretR: 3.0, turretY: 9.4,
    barrelW: 2.7, barrelTip: 0.6, muzzle: 'flare', extras: 'vents', cupola: true, antenna: false,
  },
  // Slab: the widest tracks in the game, skirted, with a plain rectangular hull and a stubby
  // ring-braked stub gun that barely clears the deck. Reads as "all armour".
  bulwark: {
    trackW: 4.4, trackR: 0.3, trackSpans: [[0.8, 15.2]], treadStep: 1.7, treadH: 0.85, skirt: true,
    hull: null, hullRect: [3.9, 2.0, 8.2, 12.2, 0.6],
    turret: 'box', turretR: 3.4, turretY: 8.6,
    barrelW: 2.1, barrelTip: 2.6, muzzle: 'ring', extras: 'bands', cupola: false, antenna: false,
  },
};

function polyPath(ctx: Ctx2D, u: number, pts: Pt[]): void {
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const [x, y] = pts[i];
    if (i === 0) ctx.moveTo(x * u, y * u);
    else ctx.lineTo(x * u, y * u);
  }
  ctx.closePath();
}

function hullPath(ctx: Ctx2D, u: number, c: Chassis): void {
  if (c.hull) polyPath(ctx, u, c.hull);
  else {
    const [x, y, w, h, r] = c.hullRect!;
    roundRect(ctx, x * u, y * u, w * u, h * u, r * u);
  }
}

function turretPath(ctx: Ctx2D, u: number, c: Chassis, scale = 1): void {
  const cx = 8 * u;
  const cy = c.turretY * u;
  const r = c.turretR * u * scale;
  switch (c.turret) {
    case 'round':
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      break;
    case 'hex':
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 3;
        ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
      ctx.closePath();
      break;
    case 'wedge':
      ctx.beginPath();
      ctx.moveTo(cx, cy - r * 1.15);
      ctx.lineTo(cx + r, cy + r * 0.15);
      ctx.lineTo(cx + r * 0.6, cy + r);
      ctx.lineTo(cx - r * 0.6, cy + r);
      ctx.lineTo(cx - r, cy + r * 0.15);
      ctx.closePath();
      break;
    default:
      roundRect(ctx, cx - r, cy - r, r * 2, r * 2, r * 0.35);
      break;
  }
}

/**
 * Draws a tank facing UP into a (size x size) canvas. `size` includes a glow margin around the body;
 * the 16x16 logical body occupies the centre 80 %.
 */
export function drawTankSprite(ctx: Ctx2D, size: number, o: TankSpriteOptions): void {
  const m = size * 0.1; // margin
  const body = size - m * 2;
  const u = body / 16; // 16 logical px
  const { primary, secondary, glow } = o.palette;
  const shape: TankShape = o.shape ?? o.palette.shape ?? 'standard';
  const c = CHASSIS[shape] ?? CHASSIS.standard;
  const player = o.isPlayer;
  const line = Math.max(1, u * 0.3);
  const dark = player ? '#151b28' : '#0d1017';
  const trackFill = player ? '#1b2130' : '#191b21';
  const rim = player ? rgba('#ffffff', 0.75) : rgba('#000000', 0.75);

  ctx.save();
  ctx.translate(m, m);

  // baked glow halo — players sit in a brighter pool of their team colour
  const gg = ctx.createRadialGradient(body / 2, body / 2, body * 0.3, body / 2, body / 2, body * 0.72);
  gg.addColorStop(0, rgba(glow, player ? 0.26 : 0.12));
  gg.addColorStop(1, rgba(glow, 0));
  ctx.fillStyle = gg;
  ctx.fillRect(-m, -m, size, size);

  // ---- tracks -------------------------------------------------------
  const trackW = c.trackW * u;
  for (const side of [0, 1]) {
    const tx = side === 0 ? 0 : body - trackW;
    for (const [y0, y1] of c.trackSpans) {
      const ty = y0 * u;
      const th = (y1 - y0) * u;
      roundRect(ctx, tx, ty, trackW, th, c.trackR * u);
      ctx.fillStyle = trackFill;
      ctx.fill();
      ctx.strokeStyle = player ? rgba(glow, 0.6) : rgba(primary, 0.35);
      ctx.lineWidth = Math.max(1, u * 0.32);
      ctx.stroke();
      // tread links
      ctx.fillStyle = player ? rgba(glow, 0.5) : rgba(primary, 0.42);
      const step = c.treadStep * u;
      for (let y = ty + u * 0.45 + (o.frame ? step / 2 : 0); y < ty + th - u * 0.8; y += step) {
        ctx.fillRect(tx + u * 0.45, y, trackW - u * 0.9, c.treadH * u);
      }
    }
    if (c.skirt) {
      // armoured side skirt: two slats over the middle of the track (elite tell — the
      // track ends stay visible so the outline differs from the heavy chassis)
      const sx = side === 0 ? u * 0.15 : body - trackW - u * 0.15;
      for (let i = 0; i < 2; i++) {
        const sy = (4.0 + i * 4.4) * u;
        roundRect(ctx, sx, sy, trackW + u * 0.6, u * 3.8, u * 0.4);
        ctx.fillStyle = mixHex(secondary, '#000000', 0.15);
        ctx.fill();
        ctx.strokeStyle = rgba(glow, 0.55);
        ctx.lineWidth = line;
        ctx.stroke();
      }
    }
  }

  // ---- extras that sit *under* the hull ------------------------------
  if (c.extras === 'wings') {
    // swept fins either side of the waist
    for (const s of [-1, 1]) {
      ctx.save();
      ctx.translate(8 * u, 8.4 * u);
      ctx.scale(s, 1);
      polyPath(ctx, u, [[3.0, -1.6], [6.6, 0.4], [6.4, 1.7], [3.0, 1.4]]);
      ctx.fillStyle = mixHex(secondary, '#000000', 0.2);
      ctx.fill();
      ctx.strokeStyle = rgba(glow, 0.75);
      ctx.lineWidth = line;
      ctx.stroke();
      ctx.restore();
    }
  }
  if (c.extras === 'stacks') {
    // rear exhaust stacks
    for (const sx of [5.3, 10.7]) {
      roundRect(ctx, (sx - 0.75) * u, 12.2 * u, 1.5 * u, 2.7 * u, u * 0.5);
      ctx.fillStyle = mixHex(secondary, '#000000', 0.35);
      ctx.fill();
      ctx.strokeStyle = rgba('#000000', 0.6);
      ctx.lineWidth = line;
      ctx.stroke();
    }
  }
  if (c.antenna) {
    ctx.strokeStyle = player ? rgba(glow, 0.9) : rgba(primary, 0.7);
    ctx.lineWidth = Math.max(1, u * 0.28);
    ctx.beginPath();
    ctx.moveTo(11.4 * u, 12.4 * u);
    ctx.lineTo(13.1 * u, 14.8 * u);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(13.1 * u, 14.8 * u, u * 0.32, 0, Math.PI * 2);
    ctx.fillStyle = player ? glow : COLORS.enemyEye;
    ctx.fill();
  }

  // ---- hull ----------------------------------------------------------
  // Form shading only. This gradient is baked into a sprite the renderer *rotates*, so anything
  // directional in here would spin the light with the hull — the exact thing that made the tanks
  // read as flat. The arena's own light is applied over the top at blit time, un-rotated, by
  // `drawTankLight`, and the gradient below is kept shallow so the two do not fight.
  const hg = ctx.createLinearGradient(0, u * 1.5, 0, u * 14.5);
  hg.addColorStop(0, player ? mixHex(primary, '#ffffff', 0.1) : primary);
  hg.addColorStop(0.55, primary);
  hg.addColorStop(1, mixHex(primary, secondary, 0.75));
  hullPath(ctx, u, c);
  ctx.fillStyle = hg;
  ctx.fill();
  // hard outline: bright for players (unmistakable at gameplay size), black for AI
  ctx.strokeStyle = rim;
  ctx.lineWidth = Math.max(1, u * (player ? 0.42 : 0.5));
  ctx.stroke();
  if (player) {
    ctx.strokeStyle = rgba(glow, 0.85);
    ctx.lineWidth = Math.max(1, u * 0.22);
    ctx.stroke();
  }

  // hull surface detail per shape
  ctx.save();
  hullPath(ctx, u, c);
  ctx.clip();
  switch (c.extras) {
    case 'glacis': {
      // bright frontal plate + two bolt rows: the heavy's tell
      ctx.fillStyle = rgba('#ffffff', 0.22);
      ctx.fillRect(3.9 * u, 2.6 * u, 8.2 * u, 1.5 * u);
      ctx.fillStyle = rgba('#000000', 0.35);
      ctx.fillRect(3.9 * u, 4.1 * u, 8.2 * u, 0.5 * u);
      ctx.fillStyle = rgba('#000000', 0.45);
      for (let i = 0; i < 4; i++) ctx.fillRect((4.7 + i * 2.1) * u, 12.6 * u, 0.7 * u, 0.7 * u);
      break;
    }
    case 'bands': {
      ctx.fillStyle = rgba('#000000', 0.35);
      ctx.fillRect(0, 5.4 * u, body, 0.6 * u);
      ctx.fillRect(0, 11.2 * u, body, 0.6 * u);
      ctx.fillStyle = rgba('#ffffff', 0.13);
      ctx.fillRect(0, 6.0 * u, body, 0.35 * u);
      break;
    }
    case 'deck': {
      // raised rear deck + hatch lines (elite)
      ctx.fillStyle = rgba('#000000', 0.28);
      roundRect(ctx, 4.6 * u, 11.4 * u, 6.8 * u, 3.0 * u, u * 0.5);
      ctx.fill();
      ctx.strokeStyle = rgba(glow, 0.5);
      ctx.lineWidth = Math.max(1, u * 0.2);
      ctx.stroke();
      ctx.fillStyle = rgba('#ffffff', 0.2);
      ctx.fillRect(4.4 * u, 3.0 * u, 7.2 * u, 0.6 * u);
      break;
    }
    case 'vents': {
      // angular panel lines (stealth)
      ctx.strokeStyle = rgba('#000000', 0.4);
      ctx.lineWidth = Math.max(1, u * 0.26);
      ctx.beginPath();
      ctx.moveTo(8 * u, 1.2 * u);
      ctx.lineTo(4.4 * u, 6.4 * u);
      ctx.lineTo(5.2 * u, 14.2 * u);
      ctx.moveTo(8 * u, 1.2 * u);
      ctx.lineTo(11.6 * u, 6.4 * u);
      ctx.lineTo(10.8 * u, 14.2 * u);
      ctx.stroke();
      ctx.fillStyle = rgba(glow, 0.55);
      ctx.fillRect(6.9 * u, 12.6 * u, 2.2 * u, 0.5 * u);
      break;
    }
    case 'wings': {
      ctx.strokeStyle = rgba(glow, 0.5);
      ctx.lineWidth = Math.max(1, u * 0.24);
      ctx.beginPath();
      ctx.moveTo(5.6 * u, 3.4 * u);
      ctx.lineTo(8 * u, 2.0 * u);
      ctx.lineTo(10.4 * u, 3.4 * u);
      ctx.stroke();
      break;
    }
    default:
      ctx.fillStyle = rgba('#ffffff', 0.1);
      ctx.fillRect(0, 3.0 * u, body, 0.6 * u);
      break;
  }
  if (!player) {
    // rivets on every AI hull
    ctx.fillStyle = rgba('#000000', 0.5);
    for (const ry of [3.6, 12.4]) for (let i = 0; i < 4; i++) ctx.fillRect((4.4 + i * 2.4) * u, ry * u, 0.6 * u, 0.6 * u);
  }
  ctx.restore();

  // hostile optic — instantly separates AI from players
  if (!player) {
    const eyeY = 4.6 * u;
    const eyeW = (c.turret === 'round' ? 3.2 : 5.0) * u;
    ctx.fillStyle = rgba('#000000', 0.75);
    roundRect(ctx, 8 * u - eyeW / 2, eyeY - u * 0.75, eyeW, u * 1.5, u * 0.45);
    ctx.fill();
    const eg = ctx.createLinearGradient(0, eyeY - u, 0, eyeY + u);
    eg.addColorStop(0, '#ff8a7a');
    eg.addColorStop(1, COLORS.enemyEye);
    ctx.fillStyle = eg;
    roundRect(ctx, 8 * u - eyeW / 2 + u * 0.3, eyeY - u * 0.35, eyeW - u * 0.6, u * 0.7, u * 0.3);
    ctx.fill();
  }

  // ---- turret --------------------------------------------------------
  const tcx = 8 * u;
  const tcy = c.turretY * u;
  turretPath(ctx, u, c);
  ctx.fillStyle = mixHex(secondary, '#000000', 0.1);
  ctx.fill();
  ctx.strokeStyle = player ? rgba('#ffffff', 0.45) : rgba('#000000', 0.6);
  ctx.lineWidth = line;
  ctx.stroke();
  turretPath(ctx, u, c, 0.66);
  ctx.fillStyle = primary;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(tcx - c.turretR * u * 0.28, tcy - c.turretR * u * 0.28, c.turretR * u * 0.3, 0, Math.PI * 2);
  ctx.fillStyle = rgba('#ffffff', player ? 0.55 : 0.3);
  ctx.fill();
  if (c.cupola) {
    ctx.beginPath();
    ctx.arc(tcx + c.turretR * u * 0.72, tcy + c.turretR * u * 0.5, c.turretR * u * 0.42, 0, Math.PI * 2);
    ctx.fillStyle = mixHex(primary, '#ffffff', 0.25);
    ctx.fill();
    ctx.strokeStyle = rgba('#000000', 0.5);
    ctx.lineWidth = Math.max(1, u * 0.2);
    ctx.stroke();
  }

  // ---- barrel(s) -----------------------------------------------------
  const tierW = player ? (o.tier >= 3 ? 1.45 : o.tier >= 1 ? 1.2 : 1) : 1;
  const barrelW = c.barrelW * u * tierW;
  const tipY = c.barrelTip * u;
  const barrelLen = tcy - tipY;
  const drawBarrel = (bx: number, w: number): void => {
    roundRect(ctx, bx - w / 2, tipY, w, barrelLen, w / 2);
    ctx.fillStyle = mixHex(secondary, '#000000', 0.2);
    ctx.fill();
    ctx.strokeStyle = player ? rgba('#ffffff', 0.35) : rgba('#000000', 0.55);
    ctx.lineWidth = Math.max(1, u * 0.22);
    ctx.stroke();
    // highlight down the left flank
    ctx.fillStyle = rgba(player ? glow : primary, 0.85);
    ctx.fillRect(bx - w / 2 + w * 0.22, tipY + w * 0.4, w * 0.3, barrelLen - w);
    switch (c.muzzle) {
      case 'brake': {
        // two side blocks near the tip
        ctx.fillStyle = mixHex(primary, '#ffffff', 0.2);
        roundRect(ctx, bx - w * 1.05, tipY + u * 0.55, w * 2.1, u * 1.5, u * 0.3);
        ctx.fill();
        ctx.strokeStyle = rgba('#000000', 0.55);
        ctx.lineWidth = Math.max(1, u * 0.2);
        ctx.stroke();
        ctx.fillStyle = rgba('#000000', 0.55);
        ctx.fillRect(bx - w * 1.05, tipY + u * 0.95, w * 2.1, u * 0.3);
        break;
      }
      case 'fork': {
        ctx.fillStyle = mixHex(primary, '#ffffff', 0.2);
        for (const s of [-1, 1]) {
          roundRect(ctx, bx + s * w * 0.75 - w * 0.28, tipY, w * 0.56, u * 2.6, w * 0.28);
          ctx.fill();
        }
        break;
      }
      case 'flare': {
        ctx.fillStyle = mixHex(secondary, '#000000', 0.35);
        polyPath(ctx, 1, [
          [bx - w * 0.95, tipY],
          [bx + w * 0.95, tipY],
          [bx + w * 0.5, tipY + u * 1.7],
          [bx - w * 0.5, tipY + u * 1.7],
        ]);
        ctx.fill();
        ctx.strokeStyle = rgba('#000000', 0.5);
        ctx.lineWidth = Math.max(1, u * 0.2);
        ctx.stroke();
        break;
      }
      case 'ring': {
        ctx.fillStyle = mixHex(primary, '#000000', 0.25);
        roundRect(ctx, bx - w * 0.78, tipY + barrelLen * 0.36, w * 1.56, u * 1.5, u * 0.35);
        ctx.fill();
        ctx.strokeStyle = rgba('#000000', 0.5);
        ctx.lineWidth = Math.max(1, u * 0.2);
        ctx.stroke();
        break;
      }
      default:
        break;
    }
  };
  if (player && o.tier >= 2) {
    drawBarrel(tcx - u * 1.5, barrelW * 0.85);
    drawBarrel(tcx + u * 1.5, barrelW * 0.85);
  } else drawBarrel(tcx, barrelW);
  if (player && o.tier >= 3) {
    ctx.fillStyle = rgba(glow, 0.9);
    ctx.fillRect(5.2 * u, 11.6 * u, 5.6 * u, 0.7 * u);
  }
  ctx.restore();
}

/**
 * Screen-space marker drawn over a player tank (never rotated with the hull), so a player can
 * never be read as an AI tank. `self` gives the local player a filled double chevron + ring.
 */
/**
 * The "this one is a player" marker: chevrons above the hull, doubled for the local player.
 *
 * There used to be a pulsing ring on the ground under the local player too. It was a permanent
 * circle around your own tank in every mode, which read as clutter rather than information — the
 * chevrons already say which tank is yours, and in solo there is nothing to disambiguate at all.
 */
/**
 * The shadow a tank drops on the deck. Drawn by the renderer *before* the hull and without the
 * hull's rotation, so it stays to the south-east however the tank is facing — a shadow that turns
 * with the tank is the tell that there is no light in the scene at all.
 */
export function drawTankShadow(ctx: Ctx2D, half: number): void {
  const d = half * LIGHT.throw;
  const g = ctx.createRadialGradient(d, d, half * 0.45, d, d, half * 1.1);
  g.addColorStop(0, 'rgba(0, 0, 0, 0.66)');
  g.addColorStop(0.6, 'rgba(0, 0, 0, 0.4)');
  g.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(d, d, half * 1.06, half * 0.96, 0, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * The arena light across a tank, as a gradient to be composited over the *rotated* hull with
 * `source-atop` — so it lands only on the tank's own pixels and follows its silhouette exactly,
 * while itself staying square to the world. Bright out of the north-west, shaded into the
 * south-east, and neutral through the middle so the paintwork keeps its colour.
 *
 * Built once per sprite size and reused: it depends on nothing but the canvas it fills.
 */
export function tankLightGradient(ctx: Ctx2D, size: number): CanvasGradient {
  const g = ctx.createLinearGradient(0, 0, size, size);
  g.addColorStop(0, 'rgba(255, 250, 235, 0.34)');
  g.addColorStop(0.34, 'rgba(255, 250, 235, 0.07)');
  g.addColorStop(0.52, 'rgba(0, 0, 0, 0)');
  g.addColorStop(0.72, 'rgba(0, 0, 0, 0.16)');
  g.addColorStop(1, 'rgba(0, 0, 0, 0.42)');
  return g;
}

/** The specular the light leaves on the upper deck. Same composite, same world-fixed direction. */
export function tankSpecular(ctx: Ctx2D, size: number): CanvasGradient {
  const c = size * 0.33;
  const g = ctx.createRadialGradient(c, c, 0, c, c, size * 0.24);
  g.addColorStop(0, 'rgba(255, 255, 255, 0.2)');
  g.addColorStop(1, 'rgba(255, 255, 255, 0)');
  return g;
}

export function drawPlayerMarker(ctx: Ctx2D, half: number, color: string, self: boolean): void {
  const w = half * 0.42;
  const y = -half - half * 0.3; // sits clear of the barrel tip
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  // both chevrons point up and stack *away* from the hull
  const chevron = (oy: number): void => {
    ctx.beginPath();
    ctx.moveTo(-w, y - oy);
    ctx.lineTo(0, y - oy - w * 0.8);
    ctx.lineTo(w, y - oy);
  };
  const stack = (): void => {
    chevron(0);
    ctx.stroke();
    if (self) {
      chevron(w * 0.62);
      ctx.stroke();
    }
  };
  // dark backing so the pip stays legible over bright tiles
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.lineWidth = Math.max(2.5, half * 0.2);
  stack();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.2, half * 0.11);
  stack();
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

/* ------------------------------------------------------------------ *
 * Tiles. The camera looks straight down, so height is drawn as a
 * chamfer: the top face is inset inside the tile and the four side
 * faces fill the margin, lit by the one arena light in `LIGHT`. No ink
 * leaves the tile, so what a player sees is exactly what collides.
 *
 * A face is drawn only where the block actually ends. `mask` says which
 * neighbours are the same material, and a run of panels reads as one
 * extruded mass instead of a grid of separate cubes.
 * ------------------------------------------------------------------ */

/** Neighbour bits: set when the tile on that side is the same material. */
export const Side = { N: 1, E: 2, S: 4, W: 8 } as const;

/** The inset of the top face on each side: zero where the block continues. */
function insets(mask: number, h: number): [number, number, number, number] {
  return [mask & Side.N ? 0 : h, mask & Side.E ? 0 : h, mask & Side.S ? 0 : h, mask & Side.W ? 0 : h];
}

/**
 * The four chamfered side faces of a raised tile, each lit by its own aspect. Drawing them before
 * the top face means the top's own edge covers the seam.
 */
function sideFaces(ctx: Ctx2D, x: number, y: number, s: number, mask: number, h: number, base: string): void {
  const [n, e, sth, w] = insets(mask, h);
  const x0 = x + w;
  const y0 = y + n;
  const x1 = x + s - e;
  const y1 = y + s - sth;
  const quad = (pts: number[][], f: number): void => {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    ctx.fillStyle = shade(base, f);
    ctx.fill();
  };
  if (n) quad([[x, y], [x + s, y], [x1, y0], [x0, y0]], LIGHT.faceN);
  if (w) quad([[x, y], [x0, y0], [x0, y1], [x, y + s]], LIGHT.faceW);
  if (e) quad([[x + s, y], [x + s, y + s], [x1, y1], [x1, y0]], LIGHT.faceE);
  if (sth) quad([[x, y + s], [x0, y1], [x1, y1], [x + s, y + s]], LIGHT.faceS);
}

/** The rectangle the top face occupies, as [x, y, w, h]. */
function topRect(x: number, y: number, s: number, mask: number, h: number): [number, number, number, number] {
  const [n, e, sth, w] = insets(mask, h);
  return [x + w, y + n, s - w - e, s - n - sth];
}

/**
 * Fills the contact shadow for every raised tile at once, from a path of their squares.
 *
 * One path filled once rather than a rectangle per tile: overlapping per-tile fills would stack
 * their alpha and leave a darker seam wherever two shadows met. The three passes at growing offset
 * and falling alpha are the penumbra — a shadow with a hard edge reads as a painted rectangle.
 *
 * This is the one thing allowed outside a tile. A shadow implies no collision, so unlike a wall's
 * own ink it cannot mislead anyone about where the wall ends. `fillTileSpill` is its other half:
 * the light thrown the opposite way, onto the deck beside the faces that catch the arena light.
 */
export function fillTileSpill(ctx: Ctx2D, path: Path2D, s: number): void {
  const d = s * LIGHT.spill;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const [scale, alpha] of [[1, 0.05], [0.55, 0.045]] as Array<[number, number]>) {
    ctx.setTransform(1, 0, 0, 1, -d * scale, -d * scale);
    ctx.fillStyle = `rgba(150, 190, 255, ${alpha})`;
    ctx.fill(path);
  }
  ctx.restore();
}

export function fillTileShadows(ctx: Ctx2D, path: Path2D, s: number): void {
  const d = s * LIGHT.throw;
  ctx.save();
  for (const [scale, alpha] of [[0.45, 0.2], [0.75, 0.16], [1, 0.13]] as Array<[number, number]>) {
    ctx.setTransform(1, 0, 0, 1, d * scale, d * scale);
    ctx.fillStyle = `rgba(0, 0, 0, ${alpha})`;
    ctx.fill(path);
  }
  ctx.restore();
}

/**
 * Strokes only the edges of the top face that are actually exposed. Stroking all four would draw a
 * seam through the middle of a slab and take a wall straight back to reading as a grid of tiles.
 */
function edges(ctx: Ctx2D, r: [number, number, number, number], mask: number, lit: boolean): void {
  const [x, y, w, h] = r;
  ctx.beginPath();
  if (lit) {
    if (!(mask & Side.W)) {
      ctx.moveTo(x, y + h);
      ctx.lineTo(x, y);
    }
    if (!(mask & Side.N)) {
      ctx.moveTo(x, y);
      ctx.lineTo(x + w, y);
    }
  } else {
    if (!(mask & Side.E)) {
      ctx.moveTo(x + w, y);
      ctx.lineTo(x + w, y + h);
    }
    if (!(mask & Side.S)) {
      ctx.moveTo(x + w, y + h);
      ctx.lineTo(x, y + h);
    }
  }
  ctx.stroke();
}

/** Static tiles. `s` is the tile size in device px; `mask` marks same-material neighbours. */
export function drawTile(ctx: Ctx2D, tile: TileId, x: number, y: number, s: number, tx: number, ty: number, mask = 0): void {
  switch (tile) {
    case Tile.BRICK: {
      // Composite panel: a plate with real thickness, its charged cell on the top face. Warm light
      // on a dark plate still reads "this one breaks".
      const h = s * LIGHT.panelHeight;
      sideFaces(ctx, x, y, s, mask, h, COLORS.panel);
      const [fx, fy, fw, fh] = topRect(x, y, s, mask, h);
      const face = ctx.createLinearGradient(fx, fy, fx + fw * 0.4, fy + fh);
      face.addColorStop(0, COLORS.panelLight);
      face.addColorStop(0.55, COLORS.panel);
      face.addColorStop(1, COLORS.panelDark);
      ctx.fillStyle = face;
      ctx.fillRect(fx, fy, fw, fh);

      ctx.save();
      ctx.beginPath();
      ctx.rect(fx, fy, fw, fh);
      ctx.clip();
      // The charged cell: one lit hexagon, the motif the whole arena is built on at its smallest
      // scale. A wall of these is a grid of live cells.
      const cellPath = (r: number): void => {
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = -Math.PI / 2 + (i * Math.PI) / 3;
          const px = x + s / 2 + Math.cos(a) * r * s;
          const py = y + s / 2 + Math.sin(a) * r * s;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
      };
      cellPath(0.26);
      ctx.strokeStyle = rgba(COLORS.panelSeam, 0.9);
      ctx.lineWidth = Math.max(0.7, s * 0.075);
      ctx.lineJoin = 'round';
      ctx.stroke();
      cellPath(0.12);
      ctx.fillStyle = rgba(COLORS.panelSeamHot, 0.85);
      ctx.fill();
      // Feed lines to the plate edges, so neighbouring panels read as connected.
      ctx.strokeStyle = rgba(COLORS.panelSeam, 0.4);
      ctx.lineWidth = Math.max(0.5, s * 0.05);
      ctx.beginPath();
      ctx.moveTo(x + s / 2, fy);
      ctx.lineTo(x + s / 2, y + s * 0.22);
      ctx.moveTo(x + s / 2, y + s * 0.78);
      ctx.lineTo(x + s / 2, fy + fh);
      ctx.stroke();
      ctx.restore();
      // Arrises: lit where the plate turns towards the light, shaded where it turns away — and only
      // where the plate actually ends.
      const top: [number, number, number, number] = [fx, fy, fw, fh];
      ctx.lineWidth = Math.max(0.6, s * 0.05);
      ctx.strokeStyle = rgba(COLORS.white, 0.24);
      edges(ctx, top, mask, true);
      ctx.strokeStyle = rgba('#000000', 0.4);
      edges(ctx, top, mask, false);
      break;
    }
    case Tile.STEEL: {
      // Structural bulkhead: a heavier block than the panel and drawn as one, so "shooting this is
      // wasted" reads before a shot is spent on it.
      const h = s * LIGHT.hullHeight;
      sideFaces(ctx, x, y, s, mask, h, COLORS.hullShadow);
      const [fx, fy, fw, fh] = topRect(x, y, s, mask, h);
      const g = ctx.createLinearGradient(fx, fy, fx + fw * 0.6, fy + fh);
      g.addColorStop(0, COLORS.hullLight);
      g.addColorStop(0.55, COLORS.hull);
      g.addColorStop(1, COLORS.hullShadow);
      ctx.fillStyle = g;
      ctx.fillRect(fx, fy, fw, fh);

      ctx.save();
      ctx.beginPath();
      ctx.rect(fx, fy, fw, fh);
      ctx.clip();
      // Hazard stripes across the lower-right of the deck, the way load-bearing structure is marked.
      ctx.strokeStyle = rgba(COLORS.hazard, 0.85);
      ctx.lineWidth = Math.max(0.9, s * 0.11);
      ctx.beginPath();
      for (let i = 0; i < 2; i++) {
        const o = s * (0.55 + i * 0.3);
        ctx.moveTo(x + o, y + s);
        ctx.lineTo(x + s, y + o);
      }
      ctx.stroke();
      ctx.restore();

      // A hard specular streak down the lit arris, the shaded one opposite: this is the edge that
      // makes it read as metal rather than as a grey square. Only where the slab actually ends.
      const deck: [number, number, number, number] = [fx, fy, fw, fh];
      ctx.lineWidth = Math.max(0.7, s * 0.055);
      ctx.strokeStyle = rgba(COLORS.white, 0.8);
      edges(ctx, deck, mask, true);
      ctx.strokeStyle = rgba('#000000', 0.55);
      edges(ctx, deck, mask, false);
      break;
    }
    case Tile.ICE: {
      // Packed snow with a hard crust. Opaque and matte so it still reads as a surface rather than
      // a pane of glass — the skid streaks are the tell that a tank carries its momentum across it —
      // but the crust catches the arena light, so it is cold and hard rather than flat white.
      const g = ctx.createLinearGradient(x, y, x, y + s);
      g.addColorStop(0, COLORS.snow);
      g.addColorStop(0.62, COLORS.snowShade);
      g.addColorStop(1, COLORS.snowDeep);
      ctx.fillStyle = g;
      ctx.fillRect(x, y, s, s);

      // Wind-blown drift ridges, offset per tile so a field of snow does not stripe.
      const seed = (tx * 73 + ty * 151) % 5;
      ctx.fillStyle = rgba(COLORS.white, 0.5);
      for (let i = 0; i < 2; i++) {
        const by = y + s * (0.22 + ((i * 2 + seed) % 5) * 0.14);
        ctx.fillRect(x + s * 0.06, by, s * 0.88, Math.max(0.6, s * 0.07));
      }

      // Skid streaks — two parallel scores in the drift, sloped so they read as motion.
      ctx.strokeStyle = rgba(COLORS.snowTrack, 0.55);
      ctx.lineWidth = Math.max(0.6, s * 0.055);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x + s * 0.12, y + s * 0.74);
      ctx.lineTo(x + s * 0.62, y + s * 0.62);
      ctx.moveTo(x + s * 0.34, y + s * 0.92);
      ctx.lineTo(x + s * 0.88, y + s * 0.79);
      ctx.stroke();

      // The crust: a broad sheen off the light, and a bright thickness edge along the lit sides.
      const gloss = ctx.createLinearGradient(x, y, x + s * 0.85, y + s * 0.85);
      gloss.addColorStop(0, rgba(COLORS.white, 0.4));
      gloss.addColorStop(0.45, rgba(COLORS.white, 0.05));
      gloss.addColorStop(1, rgba(COLORS.snowDeep, 0.22));
      ctx.fillStyle = gloss;
      ctx.fillRect(x, y, s, s);
      ctx.strokeStyle = rgba(COLORS.white, 0.72);
      ctx.lineWidth = Math.max(0.6, s * 0.05);
      // Inset by half the stroke: a line centred on the tile boundary spills into the neighbour,
      // and a slab's own ink has to stay inside the square the simulation collides against.
      const lip = ctx.lineWidth / 2;
      ctx.beginPath();
      ctx.moveTo(x + lip, y + s - lip);
      ctx.lineTo(x + lip, y + lip);
      ctx.lineTo(x + s - lip, y + lip);
      ctx.stroke();

      // Granular sparkle: a few deterministic flecks so the crust looks crystalline up close.
      ctx.fillStyle = rgba(COLORS.white, 0.9);
      for (let i = 0; i < 4; i++) {
        const hsh = (tx * 31 + ty * 17 + i * 97) % 64;
        const fx = x + s * (0.1 + ((hsh % 8) / 8) * 0.8);
        const fy = y + s * (0.1 + (Math.floor(hsh / 8) / 8) * 0.8);
        ctx.fillRect(fx, fy, Math.max(0.6, s * 0.05), Math.max(0.6, s * 0.05));
      }

      // Cold rim on the shaded sides so adjacent snow still reads as separate slabs.
      ctx.strokeStyle = rgba(COLORS.snowDeep, 0.55);
      ctx.beginPath();
      ctx.moveTo(x + s - lip, y + lip);
      ctx.lineTo(x + s - lip, y + s - lip);
      ctx.lineTo(x + lip, y + s - lip);
      ctx.stroke();
      break;
    }
    case Tile.WATER: {
      // Plasma channel — the one thing in the arena that goes *down*. The depth is the whole read:
      // the lip shades the near walls, and the floor of the trench glows well below it.
      ctx.fillStyle = rgba(COLORS.plasmaEdge, 0.38);
      ctx.fillRect(x, y, s, s);
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, s, s);
      ctx.clip();
      // A diagonal lattice at a half-tile pitch, continuous across the whole patch because its
      // phase comes from the tile's own coordinates rather than its centre.
      ctx.strokeStyle = rgba(COLORS.plasmaCore, 0.22);
      ctx.lineWidth = Math.max(0.5, s * 0.045);
      ctx.beginPath();
      for (let k = -1; k < 4; k++) {
        const o = k * s * 0.5;
        ctx.moveTo(x + o, y);
        ctx.lineTo(x + o + s, y + s);
        ctx.moveTo(x + o + s, y);
        ctx.lineTo(x + o, y + s);
      }
      ctx.stroke();
      // Inner shadow under the north and west lips, where the light cannot reach the floor.
      const d = s * 0.26;
      const north = ctx.createLinearGradient(0, y, 0, y + d);
      north.addColorStop(0, 'rgba(0,0,0,0.65)');
      north.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = north;
      if (!(mask & Side.N)) ctx.fillRect(x, y, s, d);
      const west = ctx.createLinearGradient(x, 0, x + d, 0);
      west.addColorStop(0, 'rgba(0,0,0,0.55)');
      west.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = west;
      if (!(mask & Side.W)) ctx.fillRect(x, y, d, s);
      ctx.restore();
      // The far lip catches the light, which is what tells you the surface dropped away.
      ctx.strokeStyle = rgba(COLORS.plasmaCore, 0.5);
      ctx.lineWidth = Math.max(0.6, s * 0.05);
      ctx.beginPath();
      if (!(mask & Side.S)) {
        ctx.moveTo(x, y + s - ctx.lineWidth / 2);
        ctx.lineTo(x + s, y + s - ctx.lineWidth / 2);
      }
      if (!(mask & Side.E)) {
        ctx.moveTo(x + s - ctx.lineWidth / 2, y);
        ctx.lineTo(x + s - ctx.lineWidth / 2, y + s);
      }
      ctx.stroke();
      break;
    }
    case Tile.TREES: {
      // Crystal canopy, drawn over the tanks: translucent shards growing out of the deck, thick
      // enough to hide what is underneath and faceted enough that it still reads as cover rather
      // than as a wall. Seven looks, chosen by tile coordinate. Its shadow is cast into the tile
      // layer in a separate pass, so a tank drives through shade before it disappears under the
      // canopy — which is what makes the canopy read as being above the ground.
      const seed = (tx * 73 + ty * 151) % 7;
      ctx.fillStyle = rgba(COLORS.treesDark, 0.62);
      ctx.fillRect(x, y, s, s);
      const shards: Array<[number, number, number, number]> = [
        [0.28, 0.98, 0.34, 0.30],
        [0.62, 1.02, 0.72, 0.26],
        [0.46, 0.72, 0.52, 0.34],
        [0.84, 0.94, 0.78, 0.22],
        [0.14, 0.90, 0.22, 0.24],
        [0.70, 0.66, 0.64, 0.20],
      ];
      for (let i = 0; i < shards.length; i++) {
        const [bx, by, ax, hh] = shards[(i + seed) % shards.length];
        const w = hh * 0.55;
        ctx.beginPath();
        ctx.moveTo(x + (bx - w) * s, y + by * s);
        ctx.lineTo(x + ax * s, y + (by - hh * 2) * s);
        ctx.lineTo(x + (bx + w) * s, y + by * s);
        ctx.lineTo(x + bx * s, y + (by - hh * 0.35) * s);
        ctx.closePath();
        // Each shard is lit down its north-west facet and falls away to the south-east, so the
        // whole canopy catches the light from one direction.
        const lit = ctx.createLinearGradient(x + (bx - w) * s, y + (by - hh * 2) * s, x + (bx + w) * s, y + by * s);
        lit.addColorStop(0, rgba(COLORS.treesLight, i % 2 === 0 ? 0.85 : 0.6));
        lit.addColorStop(0.45, rgba(COLORS.trees, 0.8));
        lit.addColorStop(1, rgba(COLORS.treesShard, 0.92));
        ctx.fillStyle = lit;
        ctx.fill();
        ctx.strokeStyle = rgba(COLORS.treesLight, i % 2 === 0 ? 0.8 : 0.45);
        ctx.lineWidth = Math.max(0.5, s * 0.035);
        ctx.beginPath();
        ctx.moveTo(x + (bx - w) * s, y + by * s);
        ctx.lineTo(x + ax * s, y + (by - hh * 2) * s);
        ctx.stroke();
      }
      break;
    }
    default:
      break;
  }
}

/* ---------------------------------------------------------------- *
 * The reactor core: the thing each side is defending. All coordinates
 * are in a 16x16 grid (u = s / 16) so it fills the 2x2 tile block the
 * simulation reserves for the base.
 * ---------------------------------------------------------------- */

/** Regular hexagon centred in the 16x16 block, flat-topped, `r` in the same units. */
function hexPath(ctx: Ctx2D, u: number, r: number, cx = 8, cy = 8): void {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    const px = (cx + Math.cos(a) * r) * u;
    const py = (cy + Math.sin(a) * r) * u;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function fillStroke(ctx: Ctx2D, fill: string | CanvasGradient, stroke: string, w: number): void {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = w;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

/** The base emblem occupies a 2x2 tile block. `s` is the block size in device px. */
export function drawBase(ctx: Ctx2D, x: number, y: number, s: number, dead: boolean): void {
  const u = s / 16;
  ctx.save();
  ctx.translate(x, y);

  // Housing: the machined block the core is sunk into.
  roundRect(ctx, u * 0.7, u * 0.7, s - u * 1.4, s - u * 1.4, u * 2);
  ctx.fillStyle = dead ? '#171314' : '#101828';
  ctx.fill();
  ctx.strokeStyle = dead ? rgba('#ff5e5e', 0.45) : rgba(COLORS.base, 0.75);
  ctx.lineWidth = Math.max(1, u * 0.5);
  ctx.stroke();

  const lw = Math.max(1, u * 0.34);

  if (dead) {
    // Scorch bloom over the whole housing.
    const sc = ctx.createRadialGradient(s / 2, s / 2, u * 0.5, s / 2, s / 2, s * 0.6);
    sc.addColorStop(0, 'rgba(0,0,0,0.6)');
    sc.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sc;
    ctx.fillRect(0, 0, s, s);

    // The containment ring, broken: three arcs of the hexagon left standing, buckled outwards.
    const edge = rgba('#0d0a0a', 0.9);
    const dull = ctx.createLinearGradient(0, 0, s * 0.7, s);
    dull.addColorStop(0, '#6d6a72');
    dull.addColorStop(1, '#332f36');
    for (const [rot, r] of [[0.06, 5.6], [2.2, 5.2], [4.3, 5.9]] as Array<[number, number]>) {
      ctx.save();
      ctx.translate(8 * u, 8 * u);
      ctx.rotate(rot);
      ctx.translate(-8 * u, -8 * u);
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const a = (i * Math.PI) / 3;
        const px = (8 + Math.cos(a) * r) * u;
        const py = (8 + Math.sin(a) * r) * u;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = dull;
      ctx.lineWidth = u * 1.15;
      ctx.lineCap = 'butt';
      ctx.stroke();
      ctx.strokeStyle = edge;
      ctx.lineWidth = lw * 0.6;
      ctx.stroke();
      ctx.restore();
    }

    // The well itself: burnt out, a black pit with a ragged lip.
    hexPath(ctx, u, 3.4);
    fillStroke(ctx, '#080608', rgba('#4a3a30', 0.9), lw);

    // Cracks running out of the pit across the housing.
    ctx.strokeStyle = rgba('#000000', 0.7);
    ctx.lineWidth = Math.max(1, u * 0.3);
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const [a, len] of [[0.5, 5.4], [2.0, 6.2], [3.4, 5.0], [5.1, 6.0]] as Array<[number, number]>) {
      const jitter = Math.cos(a * 3) * 0.5;
      ctx.moveTo((8 + Math.cos(a) * 3.2) * u, (8 + Math.sin(a) * 3.2) * u);
      ctx.lineTo((8 + Math.cos(a + 0.18) * (3.2 + len * 0.55)) * u, (8 + Math.sin(a + 0.18) * (3.2 + len * 0.55)) * u);
      ctx.lineTo((8 + Math.cos(a - 0.1 + jitter * 0.1) * (3.2 + len)) * u, (8 + Math.sin(a - 0.1 + jitter * 0.1) * (3.2 + len)) * u);
    }
    ctx.stroke();

    // Debris and a few embers still burning in the pit.
    ctx.fillStyle = '#3b3238';
    for (const [rx, ry, rr] of [[4.2, 12.6, 0.7], [11.9, 12.1, 0.55], [12.4, 4.6, 0.5], [3.6, 5.2, 0.45]] as Array<[number, number, number]>) {
      ctx.beginPath();
      ctx.arc(rx * u, ry * u, rr * u, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const [ex, ey] of [[7.0, 8.6], [9.2, 7.4], [8.1, 9.6]] as Array<[number, number]>) {
      const eg = ctx.createRadialGradient(ex * u, ey * u, 0, ex * u, ey * u, u * 1.6);
      eg.addColorStop(0, 'rgba(255,150,60,0.95)');
      eg.addColorStop(1, 'rgba(255,80,30,0)');
      ctx.fillStyle = eg;
      ctx.fillRect((ex - 2) * u, (ey - 2) * u, u * 4, u * 4);
    }
    ctx.restore();
    return;
  }

  // Halo: the core lighting the block it sits in.
  const halo = ctx.createRadialGradient(s / 2, s / 2, u * 1, s / 2, s / 2, s * 0.5);
  halo.addColorStop(0, rgba(COLORS.base, 0.34));
  halo.addColorStop(1, rgba(COLORS.base, 0));
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, s, s);

  const steel = ctx.createLinearGradient(0, u * 2, 0, u * 14);
  steel.addColorStop(0, '#e6edf8');
  steel.addColorStop(0.5, '#93a1b8');
  steel.addColorStop(1, '#4a5468');
  const edge = rgba('#0a1420', 0.85);

  // Containment ring: a machined hexagonal frame around the well.
  hexPath(ctx, u, 6.4);
  fillStroke(ctx, steel, edge, lw);
  // Six bolts where the frame meets the housing, one per vertex.
  ctx.fillStyle = rgba('#0a1420', 0.55);
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    ctx.beginPath();
    ctx.arc((8 + Math.cos(a) * 5.5) * u, (8 + Math.sin(a) * 5.5) * u, u * 0.42, 0, Math.PI * 2);
    ctx.fill();
  }

  // The well: a dark recess cut into the frame, so the core reads as sunk rather than stuck on.
  hexPath(ctx, u, 4.7);
  fillStroke(ctx, COLORS.baseDark, rgba('#000000', 0.6), lw * 0.8);

  // Two rings stepping down into the well, each brighter than the last.
  ctx.save();
  hexPath(ctx, u, 4.7);
  ctx.clip();
  hexPath(ctx, u, 3.7);
  ctx.strokeStyle = rgba(COLORS.base, 0.5);
  ctx.lineWidth = Math.max(1, u * 0.28);
  ctx.stroke();
  hexPath(ctx, u, 2.7);
  ctx.strokeStyle = rgba(COLORS.base, 0.8);
  ctx.stroke();
  // Light spilling up the walls of the well.
  const spill = ctx.createRadialGradient(8 * u, 8 * u, u * 0.8, 8 * u, 8 * u, u * 4.7);
  spill.addColorStop(0, rgba(COLORS.baseLight, 0.65));
  spill.addColorStop(0.55, rgba(COLORS.base, 0.22));
  spill.addColorStop(1, rgba(COLORS.base, 0));
  ctx.fillStyle = spill;
  ctx.fillRect(0, 0, s, s);
  ctx.restore();

  // The core: a bright hexagonal cell with a white centre.
  hexPath(ctx, u, 1.9);
  ctx.fillStyle = COLORS.base;
  ctx.fill();
  ctx.strokeStyle = rgba(COLORS.baseLight, 0.9);
  ctx.lineWidth = Math.max(1, u * 0.3);
  ctx.stroke();
  const hot = ctx.createRadialGradient(8 * u, 7.6 * u, 0, 8 * u, 8 * u, u * 1.9);
  hot.addColorStop(0, '#ffffff');
  hot.addColorStop(0.6, rgba(COLORS.baseLight, 0.85));
  hot.addColorStop(1, rgba(COLORS.base, 0));
  ctx.fillStyle = hot;
  hexPath(ctx, u, 1.9);
  ctx.fill();

  ctx.restore();
}

/**
 * One colour per pickup. The ids are the simulation's and never change; the names players read are
 * in `i18n` under `pu.*` (Hardpoint, Reserve, Pulse, Stasis, Bulwark, Overshield, Ferry, Railgun).
 */
export const POWERUP_COLORS: Record<PowerUpKind, string> = {
  star: COLORS.amber,
  tank: COLORS.lime,
  grenade: COLORS.magenta,
  clock: COLORS.cyan,
  shovel: '#c9d2e3',
  // Mint, not the cyan Stasis wears: the two are the pickups most often on the field together.
  helmet: '#8fffd8',
  ship: '#7fb2ff',
  gun: '#ff8a5e',
};

/**
 * Vector glyph for a power-up kind, centred in a (size x size) box.
 *
 * The `kind` strings are the simulation's ids and are older than the names players see: `star` is
 * the Hardpoint, `tank` the Reserve, `grenade` the Pulse, `clock` Stasis, `shovel` the Bulwark,
 * `helmet` the Overshield, `ship` the Ferry and `gun` the Railgun. Renaming the ids would invalidate
 * every saved inventory and every replay, so the mapping lives here instead.
 */
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
  /** Regular hexagon centred on the glyph, point up. */
  const hex = (r: number): void => {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 3;
      const px = Math.cos(a) * r * u;
      const py = Math.sin(a) * r * u;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  };
  switch (kind) {
    // Hardpoint — one more tier of cannon. Three chevrons climbing.
    case 'star': {
      ctx.lineWidth = Math.max(1, u * 1.5);
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const yy = (-4.4 + i * 3.6) * u;
        ctx.moveTo(-u * 4.6, yy + u * 2.4);
        ctx.lineTo(0, yy);
        ctx.lineTo(u * 4.6, yy + u * 2.4);
      }
      ctx.stroke();
      break;
    }
    // Reserve — a spare chassis in the bay: a filled cell with a cross cut out of it.
    case 'tank': {
      hex(6.6);
      ctx.fill();
      ctx.fillStyle = rgba('#000', 0.45);
      ctx.fillRect(-u * 1.1, -u * 3.8, u * 2.2, u * 7.6);
      ctx.fillRect(-u * 3.8, -u * 1.1, u * 7.6, u * 2.2);
      break;
    }
    // Pulse — a shockwave off the deck. The rings are broken and the gaps rotate, so it reads as
    // something travelling outwards rather than as a target.
    case 'grenade': {
      ctx.beginPath();
      ctx.arc(0, 0, u * 1.7, 0, Math.PI * 2);
      ctx.fill();
      for (let i = 0; i < 3; i++) {
        ctx.lineWidth = Math.max(0.8, u * (1.2 - i * 0.3));
        const from = -Math.PI * 0.78 + i * 0.5;
        ctx.beginPath();
        ctx.arc(0, 0, u * (3.4 + i * 1.7), from, from + Math.PI * 1.1);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 0, u * (3.4 + i * 1.7), from + Math.PI * 1.28, from + Math.PI * 1.78);
        ctx.stroke();
      }
      break;
    }
    // Stasis — everything hostile pinned where it stands: a containment lattice, anchored at its
    // six nodes. Deliberately not a snowflake; the slippery tiles are the ones that own frost here.
    case 'clock': {
      ctx.lineWidth = Math.max(0.8, u * 0.8);
      hex(5.4);
      ctx.stroke();
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 3;
        ctx.moveTo(Math.cos(a) * u * 5.4, Math.sin(a) * u * 5.4);
        ctx.lineTo(-Math.cos(a) * u * 5.4, -Math.sin(a) * u * 5.4);
      }
      ctx.stroke();
      for (let i = 0; i < 6; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 3;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * u * 5.4, Math.sin(a) * u * 5.4, u * 1.15, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(0, 0, u * 1.7, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    // Bulwark — hardened wall thrown up around the core.
    case 'shovel': {
      ctx.lineWidth = Math.max(1.2, u * 1.9);
      ctx.lineJoin = 'miter';
      ctx.lineCap = 'butt';
      ctx.beginPath();
      ctx.moveTo(-u * 6, -u * 4.6);
      ctx.lineTo(-u * 6, u * 5.2);
      ctx.lineTo(u * 6, u * 5.2);
      ctx.lineTo(u * 6, -u * 4.6);
      ctx.stroke();
      hex(2.4);
      ctx.fill();
      break;
    }
    // Overshield — a shield held clear of the hull, lit at its centre.
    case 'helmet': {
      ctx.lineWidth = Math.max(1, u * 1.3);
      ctx.beginPath();
      ctx.moveTo(0, -u * 6.2);
      ctx.lineTo(u * 5.4, -u * 3.4);
      ctx.lineTo(u * 5.4, u * 1.4);
      ctx.lineTo(0, u * 6.4);
      ctx.lineTo(-u * 5.4, u * 1.4);
      ctx.lineTo(-u * 5.4, -u * 3.4);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -u * 3.0);
      ctx.lineTo(u * 2.6, -u * 1.6);
      ctx.lineTo(u * 2.6, u * 0.8);
      ctx.lineTo(0, u * 3.2);
      ctx.lineTo(-u * 2.6, u * 0.8);
      ctx.lineTo(-u * 2.6, -u * 1.6);
      ctx.closePath();
      ctx.fill();
      break;
    }
    // Ferry — a lift pad that carries a tank across the plasma channel.
    case 'ship': {
      ctx.beginPath();
      ctx.moveTo(-u * 6.4, -u * 1.4);
      ctx.lineTo(u * 6.4, -u * 1.4);
      ctx.lineTo(u * 4.8, u * 1.6);
      ctx.lineTo(-u * 4.8, u * 1.6);
      ctx.closePath();
      ctx.fill();
      // the load riding on it
      roundRect(ctx, -u * 2.4, -u * 5.4, u * 4.8, u * 4, u * 0.8);
      ctx.fill();
      // thrust under the pad
      ctx.lineWidth = Math.max(0.8, u * 0.95);
      ctx.beginPath();
      for (let i = 0; i < 2; i++) {
        const yy = u * (3.2 + i * 2.2);
        ctx.moveTo(-u * 3.6, yy);
        ctx.lineTo(0, yy + u * 1.5);
        ctx.lineTo(u * 3.6, yy);
      }
      ctx.stroke();
      break;
    }
    // Railgun — two rails and the round running between them.
    case 'gun': {
      ctx.fillRect(-u * 6.4, -u * 4.2, u * 12, u * 1.5);
      ctx.fillRect(-u * 6.4, u * 2.7, u * 12, u * 1.5);
      ctx.fillRect(u * 5.6, -u * 4.2, u * 1.6, u * 8.4);
      ctx.beginPath();
      ctx.moveTo(-u * 3.4, -u * 1.5);
      ctx.lineTo(u * 2.4, 0);
      ctx.lineTo(-u * 3.4, u * 1.5);
      ctx.lineTo(-u * 1.9, 0);
      ctx.closePath();
      ctx.fill();
      break;
    }
  }
  ctx.restore();
}

