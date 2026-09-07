import type { Dir } from '@tank/shared';

export const DEAD_ZONE_PX = 12;
export const HYSTERESIS_DEG = 30;

/** Centre angle (degrees, screen coordinates: +y down) of each 4-way direction. */
const CENTRES: Record<Dir, number> = { 0: -90, 1: 0, 2: 90, 3: 180 };

export function angularDistance(a: number, b: number): number {
  let d = Math.abs(a - b) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

export function nearestDir(angleDeg: number): Dir {
  let best: Dir = 0;
  let bestD = Infinity;
  for (const d of [0, 1, 2, 3] as Dir[]) {
    const dist = angularDistance(angleDeg, CENTRES[d]);
    if (dist < bestD) {
      bestD = dist;
      best = d;
    }
  }
  return best;
}

/**
 * Quantises a joystick offset to a 4-way direction.
 * - inside the dead zone → -1
 * - keeps the previous direction while the stick stays within its sector widened by `hysteresisDeg`
 */
export function quantiseDir(dx: number, dy: number, prev: Dir | -1, deadZone = DEAD_ZONE_PX, hysteresisDeg = HYSTERESIS_DEG): Dir | -1 {
  if (Math.hypot(dx, dy) < deadZone) return -1;
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (prev !== -1 && angularDistance(angle, CENTRES[prev]) <= 45 + hysteresisDeg / 2) return prev;
  return nearestDir(angle);
}

/** Left-stick / d-pad style quantisation for gamepads (normalised axes, radial dead zone). */
export function quantiseAxes(ax: number, ay: number, prev: Dir | -1, deadZone = 0.35): Dir | -1 {
  return quantiseDir(ax * 100, ay * 100, prev, deadZone * 100);
}
