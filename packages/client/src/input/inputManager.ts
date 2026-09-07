import type { Input } from '@tank/shared';
import { KeyboardInput } from './keyboard.js';
import { GamepadInput } from './gamepad.js';
import { TouchControls, type TouchOptions } from './touch.js';

export interface InputManagerOptions {
  touchLayer?: HTMLElement | null;
  touch?: TouchOptions;
  onChange: (input: Input) => void;
  onPause?: () => void;
}

/**
 * Merges keyboard, gamepad and touch into a single {dir, fire}. `poll()` is called once per
 * animation frame by the game view and emits at most once per frame when the value changed.
 */
export class InputManager {
  readonly keyboard = new KeyboardInput();
  readonly gamepad = new GamepadInput();
  touch: TouchControls | null = null;
  current: Input = { dir: -1, fire: false };
  private override: Input | null = null;
  private running = false;

  constructor(private opts: InputManagerOptions) {
    if (opts.touchLayer && opts.touch) this.touch = new TouchControls(opts.touchLayer, opts.touch);
    const pause = (): void => opts.onPause?.();
    this.keyboard.onPause = pause;
    this.gamepad.onPause = pause;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.keyboard.attach();
  }

  stop(): void {
    this.running = false;
    this.keyboard.detach();
    this.touch?.destroy();
    this.touch = null;
  }

  /** Test/automation hook: forces the given input until `null` is passed. */
  setOverride(input: Input | null): void {
    this.override = input;
  }

  poll(): Input {
    if (!this.running) return this.current;
    let next: Input;
    if (this.override) next = this.override;
    else {
      const k = this.keyboard.read();
      const t = this.touch?.read() ?? { dir: -1 as const, fire: false };
      const g = this.gamepad.poll() ?? { dir: -1 as const, fire: false };
      const dir = t.dir !== -1 ? t.dir : k.dir !== -1 ? k.dir : g.dir;
      next = { dir, fire: k.fire || t.fire || g.fire };
    }
    if (next.dir !== this.current.dir || next.fire !== this.current.fire) {
      this.current = next;
      this.opts.onChange(next);
    }
    return this.current;
  }
}
