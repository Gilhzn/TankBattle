import type { Dir, Input } from '@tank/shared';

const DIR_KEYS: Record<string, Dir> = {
  ArrowUp: 0, KeyW: 0,
  ArrowRight: 1, KeyD: 1,
  ArrowDown: 2, KeyS: 2,
  ArrowLeft: 3, KeyA: 3,
};
const FIRE_KEYS = new Set(['Space', 'KeyJ', 'KeyK', 'Enter']);

/** Arrows / WASD move (last pressed wins), Space / J / K fire, Esc pause. */
export class KeyboardInput {
  private held: Dir[] = [];
  private fire = false;
  private attached = false;
  onPause: (() => void) | null = null;

  private onDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    if (e.code === 'Escape' || e.code === 'KeyP') {
      this.onPause?.();
      return;
    }
    const d = DIR_KEYS[e.code];
    if (d !== undefined) {
      this.held = this.held.filter((x) => x !== d);
      this.held.push(d);
      e.preventDefault();
    } else if (FIRE_KEYS.has(e.code)) {
      this.fire = true;
      e.preventDefault();
    }
  };
  private onUp = (e: KeyboardEvent): void => {
    const d = DIR_KEYS[e.code];
    if (d !== undefined) this.held = this.held.filter((x) => x !== d);
    else if (FIRE_KEYS.has(e.code)) this.fire = false;
  };
  private onBlur = (): void => {
    this.held = [];
    this.fire = false;
  };

  attach(): void {
    if (this.attached) return;
    this.attached = true;
    window.addEventListener('keydown', this.onDown);
    window.addEventListener('keyup', this.onUp);
    window.addEventListener('blur', this.onBlur);
  }
  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    window.removeEventListener('keydown', this.onDown);
    window.removeEventListener('keyup', this.onUp);
    window.removeEventListener('blur', this.onBlur);
    this.onBlur();
  }
  read(): Input {
    return { dir: this.held.length ? this.held[this.held.length - 1] : -1, fire: this.fire };
  }
}
