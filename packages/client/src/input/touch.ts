import type { Dir, Input } from '@tank/shared';
import { h } from '../app/h.js';
import { quantiseDir } from './joystickMath.js';

export interface TouchOptions {
  /** Diameter of the joystick ring in CSS px. */
  size: () => number;
  haptics: () => boolean;
}

/**
 * Touch controls: a floating joystick that appears where the pointer lands in the move zone,
 * quantised to 4 directions with hysteresis, and a hold-to-auto-fire button in the fire zone.
 * The zones are positioned by CSS (portrait: below the field; landscape: side gutters; mirrored by handedness).
 */
export class TouchControls {
  readonly moveZone: HTMLElement;
  readonly fireZone: HTMLElement;
  readonly joystick: HTMLElement;
  readonly knob: HTMLElement;
  readonly fireButton: HTMLElement;
  private dir: Dir | -1 = -1;
  private fire = false;
  private movePointer: number | null = null;
  private firePointer: number | null = null;
  private origin = { x: 0, y: 0 };
  active = false;

  constructor(
    private layer: HTMLElement,
    private opts: TouchOptions,
  ) {
    this.knob = h('div', { class: 'joy-knob' });
    this.joystick = h('div', { class: 'joystick idle', dataset: { testid: 'touch-joystick' } }, h('div', { class: 'joy-ring' }), this.knob, h('div', { class: 'joy-arrows' }, ...['▲', '▶', '▼', '◀'].map((a, i) => h('span', { class: `joy-arrow d${i}` }, a))));
    this.moveZone = h('div', { class: 'touch-zone move', attrs: { 'aria-label': 'joystick' } }, this.joystick);
    this.fireButton = h('button', { class: 'fire-button', type: 'button', dataset: { testid: 'touch-fire' }, attrs: { 'aria-label': 'fire' } }, h('span', { class: 'fire-core' }));
    this.fireZone = h('div', { class: 'touch-zone fire' }, this.fireButton);
    layer.append(this.moveZone, this.fireZone);

    this.moveZone.addEventListener('pointerdown', this.onMoveDown);
    this.moveZone.addEventListener('pointermove', this.onMoveMove);
    this.moveZone.addEventListener('pointerup', this.onMoveUp);
    this.moveZone.addEventListener('pointercancel', this.onMoveUp);
    this.moveZone.addEventListener('lostpointercapture', this.onMoveUp);
    this.fireZone.addEventListener('pointerdown', this.onFireDown);
    this.fireZone.addEventListener('pointerup', this.onFireUp);
    this.fireZone.addEventListener('pointercancel', this.onFireUp);
    this.fireZone.addEventListener('lostpointercapture', this.onFireUp);
    for (const z of [this.moveZone, this.fireZone]) z.addEventListener('contextmenu', (e) => e.preventDefault());
    this.resetJoystick();
  }

  private radius(): number {
    return this.opts.size() / 2;
  }

  private resetJoystick(): void {
    const size = this.opts.size();
    this.joystick.style.width = `${size}px`;
    this.joystick.style.height = `${size}px`;
    this.joystick.classList.add('idle');
    this.joystick.style.left = '';
    this.joystick.style.top = '';
    this.joystick.style.transform = '';
    this.knob.style.transform = 'translate(-50%, -50%)';
    this.joystick.dataset.dir = '';
  }

  private onMoveDown = (e: PointerEvent): void => {
    if (this.movePointer !== null) return;
    e.preventDefault();
    this.movePointer = e.pointerId;
    this.active = true;
    const rect = this.moveZone.getBoundingClientRect();
    const r = this.radius();
    // keep the ring fully inside the zone
    const x = Math.min(Math.max(e.clientX - rect.left, r), Math.max(r, rect.width - r));
    const y = Math.min(Math.max(e.clientY - rect.top, r), Math.max(r, rect.height - r));
    this.origin = { x: rect.left + x, y: rect.top + y };
    this.joystick.classList.remove('idle');
    this.joystick.style.left = `${x}px`;
    this.joystick.style.top = `${y}px`;
    this.joystick.style.transform = 'translate(-50%, -50%)';
    try {
      this.moveZone.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    this.updateStick(e.clientX, e.clientY);
  };

  private onMoveMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.movePointer) return;
    e.preventDefault();
    this.updateStick(e.clientX, e.clientY);
  };

  private onMoveUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.movePointer) return;
    this.movePointer = null;
    this.dir = -1;
    this.resetJoystick();
  };

  private updateStick(cx: number, cy: number): void {
    const dx = cx - this.origin.x;
    const dy = cy - this.origin.y;
    const r = this.radius() * 0.6;
    const len = Math.hypot(dx, dy);
    const k = len > r ? r / len : 1;
    this.knob.style.transform = `translate(calc(-50% + ${dx * k}px), calc(-50% + ${dy * k}px))`;
    const prev = this.dir;
    this.dir = quantiseDir(dx, dy, prev);
    if (this.dir !== prev) this.joystick.dataset.dir = this.dir === -1 ? '' : String(this.dir);
  }

  private onFireDown = (e: PointerEvent): void => {
    e.preventDefault();
    if (this.firePointer !== null) return;
    this.firePointer = e.pointerId;
    this.fire = true;
    this.active = true;
    this.fireButton.classList.add('pressed');
    try {
      this.fireZone.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (this.opts.haptics() && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(8);
      } catch {
        /* ignore */
      }
    }
  };

  private onFireUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.firePointer) return;
    this.firePointer = null;
    this.fire = false;
    this.fireButton.classList.remove('pressed');
  };

  read(): Input {
    return { dir: this.dir, fire: this.fire };
  }

  /** Programmatic override used by the test hook. */
  set(input: Input): void {
    this.dir = input.dir;
    this.fire = input.fire;
  }

  destroy(): void {
    this.moveZone.remove();
    this.fireZone.remove();
    void this.layer;
  }
}
