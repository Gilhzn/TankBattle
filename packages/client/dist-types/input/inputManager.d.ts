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
export declare class InputManager {
    private opts;
    readonly keyboard: KeyboardInput;
    readonly gamepad: GamepadInput;
    touch: TouchControls | null;
    current: Input;
    private override;
    private running;
    constructor(opts: InputManagerOptions);
    start(): void;
    stop(): void;
    /** Test/automation hook: forces the given input until `null` is passed. */
    setOverride(input: Input | null): void;
    poll(): Input;
}
//# sourceMappingURL=inputManager.d.ts.map