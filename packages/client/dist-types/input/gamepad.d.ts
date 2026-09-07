import type { Input } from '@tank/shared';
/** Standard-mapping gamepad: d-pad (12-15) + left stick, A (0) / RT (7) fire, Start (9) pause. */
export declare class GamepadInput {
    private prevDir;
    private startHeld;
    onPause: (() => void) | null;
    /** Returns null when no gamepad is connected. */
    poll(): Input | null;
}
//# sourceMappingURL=gamepad.d.ts.map