import { describe, expect, it } from 'vitest';
import { quantiseAxes, quantiseDir } from './joystickMath.js';

const fromAngle = (deg: number, r = 50): [number, number] => [Math.cos((deg * Math.PI) / 180) * r, Math.sin((deg * Math.PI) / 180) * r];

describe('quantiseDir', () => {
  it('maps cardinal offsets to the 4 directions', () => {
    expect(quantiseDir(0, -50, -1)).toBe(0);
    expect(quantiseDir(50, 0, -1)).toBe(1);
    expect(quantiseDir(0, 50, -1)).toBe(2);
    expect(quantiseDir(-50, 0, -1)).toBe(3);
  });
  it('respects the dead zone', () => {
    expect(quantiseDir(5, 5, -1)).toBe(-1);
    expect(quantiseDir(11, 0, 1)).toBe(-1);
    expect(quantiseDir(13, 0, -1)).toBe(1);
  });
  it('picks the nearest direction on diagonals without a previous direction', () => {
    expect(quantiseDir(...fromAngle(-50), -1)).toBe(0); // mostly up
    expect(quantiseDir(...fromAngle(-40), -1)).toBe(1); // mostly right
  });
  it('applies hysteresis around the previous direction', () => {
    // 50° away from "up" centre: outside the plain 45° sector but inside 45 + 15 → keep up
    expect(quantiseDir(...fromAngle(-40), 0)).toBe(0);
    // 70° away → switch to right
    expect(quantiseDir(...fromAngle(-20), 0)).toBe(1);
    // and coming back needs to cross the widened boundary of "right"
    expect(quantiseDir(...fromAngle(-55), 1)).toBe(1);
    expect(quantiseDir(...fromAngle(-70), 1)).toBe(0);
  });
  it('quantises normalised gamepad axes with a radial dead zone', () => {
    expect(quantiseAxes(0.2, 0.2, -1)).toBe(-1);
    expect(quantiseAxes(0, -0.9, -1)).toBe(0);
    expect(quantiseAxes(-0.8, 0.1, -1)).toBe(3);
  });
});
