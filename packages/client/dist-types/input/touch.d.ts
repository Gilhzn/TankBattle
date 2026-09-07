import type { Input } from '@tank/shared';
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
export declare class TouchControls {
    private layer;
    private opts;
    readonly moveZone: HTMLElement;
    readonly fireZone: HTMLElement;
    readonly joystick: HTMLElement;
    readonly knob: HTMLElement;
    readonly fireButton: HTMLElement;
    private dir;
    private fire;
    private movePointer;
    private firePointer;
    private origin;
    active: boolean;
    constructor(layer: HTMLElement, opts: TouchOptions);
    private radius;
    private resetJoystick;
    private onMoveDown;
    private onMoveMove;
    private onMoveUp;
    private updateStick;
    private onFireDown;
    private onFireUp;
    read(): Input;
    /** Programmatic override used by the test hook. */
    set(input: Input): void;
    destroy(): void;
}
//# sourceMappingURL=touch.d.ts.map