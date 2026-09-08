import { Tile, type PowerUpKind, type TankShape, type TileId } from '@tank/shared';
import { COLORS, mixHex, rgba, type Palette } from './theme.js';

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
  // Free / ally chassis — the familiar rounded Battle City hull.
  standard: {
    trackW: 3.4, trackR: 1.2, trackSpans: [[1, 15]], treadStep: 1.6, treadH: 0.55, skirt: false,
    hull: null, hullRect: [3.0, 2.2, 10.0, 11.6, 2],
    turret: 'round', turretR: 3.1, turretY: 8.8,
    barrelW: 1.4, barrelTip: 0.2, muzzle: 'none', extras: 'none', cupola: false, antenna: false,
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
  gg.addColorStop(0, rgba(glow, player ? 0.4 : 0.16));
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
  const hg = ctx.createLinearGradient(0, u * 1.5, 0, u * 14.5);
  hg.addColorStop(0, player ? mixHex(primary, '#ffffff', 0.18) : primary);
  hg.addColorStop(0.55, primary);
  hg.addColorStop(1, secondary);
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
      // Packed snow. Opaque and matte so it reads as a surface rather than a pane of glass, with
      // skid streaks along the drift: the tell that a tank carries its momentum across this tile.
      const g = ctx.createLinearGradient(x, y, x, y + s);
      g.addColorStop(0, COLORS.snow);
      g.addColorStop(0.62, COLORS.snowShade);
      g.addColorStop(1, COLORS.snowDeep);
      ctx.fillStyle = g;
      ctx.fillRect(x, y, s, s);

      // Wind-blown drift ridges: soft horizontal bands, offset per tile so a field of snow does
      // not stripe into one continuous line.
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

      // Granular sparkle: a few deterministic flecks so the surface looks crystalline up close.
      ctx.fillStyle = rgba(COLORS.white, 0.85);
      for (let i = 0; i < 4; i++) {
        const h = (tx * 31 + ty * 17 + i * 97) % 64;
        const fx = x + s * (0.1 + ((h % 8) / 8) * 0.8);
        const fy = y + s * (0.1 + (Math.floor(h / 8) / 8) * 0.8);
        ctx.fillRect(fx, fy, Math.max(0.6, s * 0.05), Math.max(0.6, s * 0.05));
      }

      // Cold rim so adjacent snow tiles still read as separate blocks against the dark field.
      ctx.strokeStyle = rgba(COLORS.snowDeep, 0.5);
      ctx.lineWidth = Math.max(0.5, s * 0.045);
      ctx.strokeRect(x + ctx.lineWidth / 2, y + ctx.lineWidth / 2, s - ctx.lineWidth, s - ctx.lineWidth);
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

/* ---------------------------------------------------------------- *
 * Eagle emblem. All coordinates are in a 16x16 grid (u = s / 16) so the
 * whole bird fits the 2x2 tile base block. Drawn as a left half that is
 * mirrored, plus a central body / head / tail.
 * ---------------------------------------------------------------- */

/**
 * One outstretched wing, swept up and out from the shoulder with four feather points along its
 * trailing edge. Mirrored for the other side.
 */
const EAGLE_WING: Pt[] = [
  [7.0, 6.0], [5.2, 3.9], [3.2, 2.1], [1.0, 1.1],
  [2.8, 3.2], [1.2, 4.6], [3.4, 5.0], [1.9, 6.6],
  [4.2, 6.8], [3.0, 8.4], [5.2, 8.2], [4.5, 9.9], [6.5, 8.5],
];
const EAGLE_BODY: Pt[] = [
  [6.9, 5.0], [9.1, 5.0], [9.5, 8.4], [8.75, 11.5], [7.25, 11.5], [6.5, 8.4],
];
const EAGLE_TAIL: Pt[] = [
  [7.1, 10.6], [8.9, 10.6], [10.2, 14.7], [8.7, 13.4], [8.0, 15.0], [7.3, 13.4], [5.8, 14.7],
];
const EAGLE_HEAD_C: Pt = [8, 3.8];
/** Hooked beak. */
const EAGLE_BEAK: Pt[] = [
  [7.2, 3.2], [4.9, 4.0], [5.9, 4.6], [7.2, 4.9],
];

function mirrorX(pts: Pt[]): Pt[] {
  return pts.map(([x, y]): Pt => [16 - x, y]);
}

function eaglePath(ctx: Ctx2D, u: number, part: 'wings' | 'body' | 'tail' | 'head' | 'beak'): void {
  switch (part) {
    case 'wings':
      polyPath(ctx, u, EAGLE_WING);
      break;
    case 'body':
      polyPath(ctx, u, EAGLE_BODY);
      break;
    case 'tail':
      polyPath(ctx, u, EAGLE_TAIL);
      break;
    case 'beak':
      polyPath(ctx, u, EAGLE_BEAK);
      break;
    default:
      ctx.beginPath();
      ctx.arc(EAGLE_HEAD_C[0] * u, EAGLE_HEAD_C[1] * u, 1.35 * u, 0, Math.PI * 2);
      break;
  }
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

  // pedestal
  roundRect(ctx, u * 0.7, u * 0.7, s - u * 1.4, s - u * 1.4, u * 2);
  ctx.fillStyle = dead ? '#35281f' : '#131a2c';
  ctx.fill();
  ctx.strokeStyle = dead ? rgba('#ff5e5e', 0.45) : rgba(COLORS.amber, 0.75);
  ctx.lineWidth = Math.max(1, u * 0.5);
  ctx.stroke();

  if (dead) {
    // scorch bloom
    const sc = ctx.createRadialGradient(s / 2, s * 0.62, u * 0.5, s / 2, s * 0.62, s * 0.55);
    sc.addColorStop(0, 'rgba(0,0,0,0.55)');
    sc.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sc;
    ctx.fillRect(0, 0, s, s);

    const edge = rgba('#120d0a', 0.9);
    const lw = Math.max(1, u * 0.34);
    /** Charred metal: lit from the top-left, ember-warm at the bottom. */
    const wreckFill = (light: boolean): CanvasGradient => {
      const g = ctx.createLinearGradient(0, 0, s * 0.7, s);
      g.addColorStop(0, light ? '#b5a189' : '#83705c');
      g.addColorStop(1, light ? '#6b5a49' : '#473b30');
      return g;
    };
    // left wing: snapped off half way, still attached and drooping
    ctx.save();
    ctx.translate(u * 0.6, u * 2.4);
    ctx.rotate(0.26);
    polyPath(ctx, u, [[7.0, 6.2], [5.4, 4.2], [3.9, 3.4], [4.6, 5.0], [3.2, 5.2], [4.2, 6.4], [3.6, 7.6], [5.0, 7.5], [4.7, 9.1], [6.6, 7.9]]);
    fillStroke(ctx, wreckFill(true), edge, lw);
    ctx.restore();
    // right wing torn clean off, fallen across the plinth
    ctx.save();
    ctx.translate(s * 0.7, s * 0.66);
    ctx.rotate(0.95);
    ctx.translate(-8 * u, -6 * u);
    polyPath(ctx, u, mirrorX([[7.0, 6.2], [5.4, 4.2], [3.6, 3.2], [4.4, 5.0], [3.0, 5.4], [4.2, 6.6], [3.4, 7.8], [5.0, 7.6], [4.7, 9.2], [6.6, 8.0]]));
    fillStroke(ctx, wreckFill(false), edge, lw);
    ctx.restore();
    // torso: cracked open, the top of the chest blown away
    ctx.save();
    ctx.rotate(0.13);
    ctx.translate(u * 0.1, u * 0.5);
    polyPath(ctx, u, EAGLE_TAIL);
    fillStroke(ctx, wreckFill(false), edge, lw);
    polyPath(ctx, u, [[6.75, 7.7], [7.6, 6.3], [8.2, 7.6], [9.1, 6.0], [9.35, 8.4], [8.7, 11.5], [7.3, 11.5], [6.65, 8.4]]);
    fillStroke(ctx, wreckFill(true), edge, lw);
    ctx.strokeStyle = rgba('#0b0706', 0.9);
    ctx.lineWidth = Math.max(1, u * 0.32);
    ctx.beginPath();
    ctx.moveTo(7.3 * u, 7.9 * u);
    ctx.lineTo(8.4 * u, 9.4 * u);
    ctx.lineTo(7.5 * u, 10.5 * u);
    ctx.lineTo(8.5 * u, 11.5 * u);
    ctx.stroke();
    ctx.restore();
    // severed head lying at the foot of the plinth
    ctx.save();
    ctx.translate(s * 0.26, s * 0.84);
    ctx.rotate(-1.35);
    ctx.translate(-8 * u, -3.8 * u);
    eaglePath(ctx, u, 'beak');
    fillStroke(ctx, '#8a6a2c', edge, lw);
    eaglePath(ctx, u, 'head');
    fillStroke(ctx, wreckFill(true), edge, lw);
    ctx.fillStyle = '#0b0706';
    ctx.beginPath();
    ctx.arc(8.35 * u, 3.5 * u, u * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // cracks running out across the plinth
    ctx.strokeStyle = rgba('#000000', 0.65);
    ctx.lineWidth = Math.max(1, u * 0.28);
    ctx.beginPath();
    ctx.moveTo(2.0 * u, 12.6 * u);
    ctx.lineTo(4.6 * u, 11.4 * u);
    ctx.lineTo(6.0 * u, 12.4 * u);
    ctx.moveTo(14.0 * u, 4.2 * u);
    ctx.lineTo(11.4 * u, 5.4 * u);
    ctx.lineTo(11.9 * u, 7.0 * u);
    ctx.stroke();
    // rubble shards
    ctx.fillStyle = '#463a2e';
    for (const [rx, ry, rr] of [[4.0, 13.9, 0.8], [11.6, 14.1, 0.6], [6.1, 14.6, 0.45], [12.9, 10.4, 0.55], [2.9, 9.8, 0.5]]) {
      ctx.beginPath();
      ctx.arc(rx * u, ry * u, rr * u, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const [ex, ey] of [[5.0, 11.6], [10.6, 12.2], [7.8, 8.2]]) {
      const eg = ctx.createRadialGradient(ex * u, ey * u, 0, ex * u, ey * u, u * 1.5);
      eg.addColorStop(0, 'rgba(255,150,60,0.95)');
      eg.addColorStop(1, 'rgba(255,80,30,0)');
      ctx.fillStyle = eg;
      ctx.fillRect((ex - 2) * u, (ey - 2) * u, u * 4, u * 4);
    }
    ctx.restore();
    return;
  }

  // amber halo behind the bird
  const halo = ctx.createRadialGradient(s / 2, s * 0.5, u * 1, s / 2, s * 0.5, s * 0.5);
  halo.addColorStop(0, rgba(COLORS.amber, 0.3));
  halo.addColorStop(1, rgba(COLORS.amber, 0));
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, s, s);

  const gold = ctx.createLinearGradient(0, u * 3, 0, u * 14);
  gold.addColorStop(0, COLORS.baseLight);
  gold.addColorStop(0.5, COLORS.base);
  gold.addColorStop(1, '#c78f1e');
  const edge = rgba('#2a1c05', 0.85);
  const lw = Math.max(1, u * 0.3);

  // tail first (behind the body)
  eaglePath(ctx, u, 'tail');
  fillStroke(ctx, gold, edge, lw);
  // talons
  ctx.strokeStyle = '#a0741a';
  ctx.lineWidth = Math.max(1, u * 0.5);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(7.3 * u, 10.9 * u);
  ctx.lineTo(6.3 * u, 12.6 * u);
  ctx.lineTo(5.2 * u, 12.8 * u);
  ctx.moveTo(6.5 * u, 12.5 * u);
  ctx.lineTo(6.0 * u, 13.6 * u);
  ctx.moveTo(8.7 * u, 10.9 * u);
  ctx.lineTo(9.7 * u, 12.6 * u);
  ctx.lineTo(10.8 * u, 12.8 * u);
  ctx.moveTo(9.5 * u, 12.5 * u);
  ctx.lineTo(10.0 * u, 13.6 * u);
  ctx.stroke();
  // wings
  polyPath(ctx, u, EAGLE_WING);
  fillStroke(ctx, gold, edge, lw);
  polyPath(ctx, u, mirrorX(EAGLE_WING));
  fillStroke(ctx, gold, edge, lw);
  // body
  eaglePath(ctx, u, 'body');
  fillStroke(ctx, gold, edge, lw);
  // chest shading + breast feathers
  ctx.save();
  eaglePath(ctx, u, 'body');
  ctx.clip();
  ctx.strokeStyle = rgba('#8a5f10', 0.55);
  ctx.lineWidth = Math.max(1, u * 0.22);
  for (let i = 0; i < 3; i++) {
    const yy = (6.7 + i * 1.5) * u;
    ctx.beginPath();
    ctx.arc(8 * u, yy, 1.15 * u, Math.PI * 0.15, Math.PI * 0.85);
    ctx.stroke();
  }
  ctx.restore();
  // head + beak + eye — pale head over a gold body reads unmistakably as an eagle
  eaglePath(ctx, u, 'beak');
  fillStroke(ctx, '#ffa61f', edge, lw);
  const headFill = ctx.createLinearGradient(0, u * 2.2, 0, u * 5.4);
  headFill.addColorStop(0, '#fffaf0');
  headFill.addColorStop(1, '#e8d8b0');
  eaglePath(ctx, u, 'head');
  fillStroke(ctx, headFill, edge, lw);
  ctx.fillStyle = '#1a1005';
  ctx.beginPath();
  ctx.arc(8.35 * u, 3.5 * u, u * 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = rgba('#ffffff', 0.85);
  ctx.beginPath();
  ctx.arc(8.5 * u, 3.35 * u, u * 0.15, 0, Math.PI * 2);
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
