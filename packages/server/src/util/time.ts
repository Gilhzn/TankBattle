export const DAY_MS = 86_400_000;

/** Monotonic clock source (ms since epoch); injectable for tests. */
export type Clock = () => number;

/** UTC day index for a timestamp. */
export function utcDay(ms: number): number {
  return Math.floor(ms / DAY_MS);
}

export function dayStart(day: number): number {
  return day * DAY_MS;
}
