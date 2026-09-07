import type { Dir } from '@tank/shared';
export declare const DEAD_ZONE_PX = 12;
export declare const HYSTERESIS_DEG = 30;
export declare function angularDistance(a: number, b: number): number;
export declare function nearestDir(angleDeg: number): Dir;
/**
 * Quantises a joystick offset to a 4-way direction.
 * - inside the dead zone → -1
 * - keeps the previous direction while the stick stays within its sector widened by `hysteresisDeg`
 */
export declare function quantiseDir(dx: number, dy: number, prev: Dir | -1, deadZone?: number, hysteresisDeg?: number): Dir | -1;
/** Left-stick / d-pad style quantisation for gamepads (normalised axes, radial dead zone). */
export declare function quantiseAxes(ax: number, ay: number, prev: Dir | -1, deadZone?: number): Dir | -1;
//# sourceMappingURL=joystickMath.d.ts.map