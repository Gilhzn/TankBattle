import type { Input } from '@tank/shared';
/** Arrows / WASD move (last pressed wins), Space / J / K fire, Esc pause. */
export declare class KeyboardInput {
    private held;
    private fire;
    private attached;
    onPause: (() => void) | null;
    private onDown;
    private onUp;
    private onBlur;
    attach(): void;
    detach(): void;
    read(): Input;
}
//# sourceMappingURL=keyboard.d.ts.map