import { COLORS, hexToRgb } from './theme.js';
import type { Ctx2D } from './sprites.js';

const MAX_PARTICLES = 400;
const MAX_RINGS = 12;
const MAX_POPUPS = 16;

interface Particle {
  alive: boolean;
  x: number; // logical (sub-pixel) units
  y: number;
  vx: number; // sub/ms
  vy: number;
  life: number; // ms remaining
  max: number;
  size: number; // logical
  r: number;
  g: number;
  b: number;
  shape: 0 | 1 | 2; // square, dot, spark line
  gravity: number;
  drag: number;
}

interface Ring {
  x: number;
  y: number;
  life: number;
  max: number;
  radius: number;
  color: string;
  width: number;
}

interface Popup {
  x: number;
  y: number;
  text: string;
  life: number;
  max: number;
  color: string;
}

/** Object-pooled particles + shockwave rings + score popups + screen shake. All positions are in logical field units. */
export class Effects {
  private pool: Particle[] = [];
  private rings: Ring[] = [];
  private popups: Popup[] = [];
  private shakePower = 0;
  private shakeT = 0;
  flash = 0; // 0..1 white flash

  constructor(private reducedMotion: () => boolean) {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.pool.push({ alive: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, size: 8, r: 255, g: 255, b: 255, shape: 0, gravity: 0, drag: 0 });
    }
  }

  clear(): void {
    for (const p of this.pool) p.alive = false;
    this.rings = [];
    this.popups = [];
    this.shakePower = 0;
    this.flash = 0;
  }

  private spawn(x: number, y: number, vx: number, vy: number, life: number, size: number, color: string, shape: 0 | 1 | 2, gravity = 0, drag = 0): void {
    let p = this.pool.find((q) => !q.alive);
    if (!p) {
      // recycle the oldest
      p = this.pool.reduce((a, b) => (a.life < b.life ? a : b));
    }
    const [r, g, b] = hexToRgb(color);
    p.alive = true;
    p.x = x;
    p.y = y;
    p.vx = vx;
    p.vy = vy;
    p.life = life;
    p.max = life;
    p.size = size;
    p.r = r;
    p.g = g;
    p.b = b;
    p.shape = shape;
    p.gravity = gravity;
    p.drag = drag;
  }

  private count(n: number): number {
    return this.reducedMotion() ? Math.ceil(n / 3) : n;
  }

  brick(x: number, y: number): void {
    const n = this.count(8);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 0.08 + Math.random() * 0.16;
      this.spawn(x, y, Math.cos(a) * sp, Math.sin(a) * sp - 0.1, 320 + Math.random() * 220, 6 + Math.random() * 8, i % 3 === 0 ? COLORS.brickLight : COLORS.brick, 0, 0.0006, 0.002);
    }
  }

  sparks(x: number, y: number, color = COLORS.amber): void {
    const n = this.count(7);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 0.15 + Math.random() * 0.3;
      this.spawn(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 140 + Math.random() * 160, 4 + Math.random() * 4, i % 2 ? color : COLORS.white, 2, 0, 0.004);
    }
  }

  explosion(x: number, y: number, big: boolean): void {
    const n = this.count(big ? 34 : 14);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (big ? 0.12 : 0.08) + Math.random() * (big ? 0.35 : 0.2);
      const c = i % 4 === 0 ? COLORS.white : i % 4 === 1 ? COLORS.amber : i % 4 === 2 ? COLORS.magenta : '#ff7a3d';
      this.spawn(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 300 + Math.random() * 400, 6 + Math.random() * (big ? 14 : 8), c, i % 3 === 0 ? 1 : 0, 0.0003, 0.003);
    }
    this.ring(x, y, big ? 260 : 120, big ? 420 : 260, big ? COLORS.amber : COLORS.magenta, big ? 14 : 8);
    if (big) {
      this.ring(x, y, 400, 600, COLORS.white, 5);
      this.shake(1);
      this.flash = Math.max(this.flash, this.reducedMotion() ? 0.15 : 0.45);
    }
  }

  ring(x: number, y: number, radius: number, life: number, color: string, width: number): void {
    if (this.rings.length >= MAX_RINGS) this.rings.shift();
    this.rings.push({ x, y, life, max: life, radius, color, width });
  }

  spawnRing(x: number, y: number, color: string): void {
    this.ring(x, y, 160, 500, color, 6);
    const n = this.count(10);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.spawn(x + Math.cos(a) * 90, y + Math.sin(a) * 90, -Math.cos(a) * 0.12, -Math.sin(a) * 0.12, 420, 6, color, 1, 0, 0);
    }
  }

  pickup(x: number, y: number, color: string): void {
    this.ring(x, y, 200, 450, color, 8);
    const n = this.count(16);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 0.1 + Math.random() * 0.2;
      this.spawn(x, y, Math.cos(a) * sp, Math.sin(a) * sp - 0.15, 500 + Math.random() * 300, 5 + Math.random() * 5, i % 2 ? color : COLORS.white, 1, 0.0004, 0.002);
    }
  }

  popup(x: number, y: number, text: string, color = COLORS.amber): void {
    if (this.popups.length >= MAX_POPUPS) this.popups.shift();
    this.popups.push({ x, y, text, life: 900, max: 900, color });
  }

  shake(power: number): void {
    if (this.reducedMotion()) return;
    this.shakePower = Math.min(1.5, this.shakePower + power);
    this.shakeT = 0;
  }

  /** Current shake offset in device px (≤ 4 px at full power). */
  shakeOffset(): [number, number] {
    if (this.shakePower <= 0.01) return [0, 0];
    const amp = Math.min(4, 4 * this.shakePower);
    return [Math.sin(this.shakeT * 0.09) * amp, Math.cos(this.shakeT * 0.07) * amp];
  }

  update(dt: number): void {
    for (const p of this.pool) {
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.alive = false;
        continue;
      }
      p.vy += p.gravity * dt;
      if (p.drag) {
        const k = Math.max(0, 1 - p.drag * dt);
        p.vx *= k;
        p.vy *= k;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      this.rings[i].life -= dt;
      if (this.rings[i].life <= 0) this.rings.splice(i, 1);
    }
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const pp = this.popups[i];
      pp.life -= dt;
      pp.y -= dt * 0.04;
      if (pp.life <= 0) this.popups.splice(i, 1);
    }
    if (this.shakePower > 0) {
      this.shakeT += dt;
      this.shakePower = Math.max(0, this.shakePower - dt * 0.004);
    }
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 0.004);
  }

  /** Draws in device px; `scale` converts logical units. */
  draw(ctx: Ctx2D, scale: number, fontPx: number): void {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.pool) {
      if (!p.alive) continue;
      const a = Math.min(1, p.life / p.max);
      ctx.fillStyle = `rgba(${p.r},${p.g},${p.b},${a})`;
      const s = p.size * scale;
      const x = p.x * scale;
      const y = p.y * scale;
      if (p.shape === 0) ctx.fillRect(x - s / 2, y - s / 2, s, s);
      else if (p.shape === 1) {
        ctx.beginPath();
        ctx.arc(x, y, s / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.strokeStyle = ctx.fillStyle;
        ctx.lineWidth = Math.max(1, s * 0.35);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - p.vx * 40 * scale, y - p.vy * 40 * scale);
        ctx.stroke();
      }
    }
    for (const r of this.rings) {
      const t = 1 - r.life / r.max;
      const [cr, cg, cb] = hexToRgb(r.color);
      ctx.strokeStyle = `rgba(${cr},${cg},${cb},${(1 - t) * 0.9})`;
      ctx.lineWidth = Math.max(1, r.width * (1 - t) * scale);
      ctx.beginPath();
      ctx.arc(r.x * scale, r.y * scale, Math.max(1, r.radius * Math.sqrt(t) * scale), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
    if (this.popups.length) {
      ctx.save();
      ctx.font = `700 ${fontPx}px ui-rounded, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const pp of this.popups) {
        const a = Math.min(1, pp.life / 300);
        ctx.globalAlpha = a;
        ctx.fillStyle = '#000';
        ctx.fillText(pp.text, pp.x * scale + 1, pp.y * scale + 1);
        ctx.fillStyle = pp.color;
        ctx.fillText(pp.text, pp.x * scale, pp.y * scale);
      }
      ctx.restore();
    }
  }
}
