import type { Dir, Input } from '@tank/shared';
import { quantiseAxes } from './joystickMath.js';

/** Standard-mapping gamepad: d-pad (12-15) + left stick, A (0) / RT (7) fire, Start (9) pause. */
export class GamepadInput {
  private prevDir: Dir | -1 = -1;
  private startHeld = false;
  onPause: (() => void) | null = null;

  /** Returns null when no gamepad is connected. */
  poll(): Input | null {
    if (typeof navigator.getGamepads !== 'function') return null;
    let pads: (Gamepad | null)[];
    try {
      pads = navigator.getGamepads();
    } catch {
      return null;
    }
    const gp = pads.find((p) => p && p.connected);
    if (!gp) return null;
    const b = (i: number): boolean => !!gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > 0.5);
    let dir: Dir | -1 = -1;
    if (b(12)) dir = 0;
    else if (b(15)) dir = 1;
    else if (b(13)) dir = 2;
    else if (b(14)) dir = 3;
    else dir = quantiseAxes(gp.axes[0] ?? 0, gp.axes[1] ?? 0, this.prevDir);
    this.prevDir = dir;
    const fire = b(0) || b(7) || b(5);
    const start = b(9);
    if (start && !this.startHeld) this.onPause?.();
    this.startHeld = start;
    return { dir, fire };
  }
}
