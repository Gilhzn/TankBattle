/** mulberry32: small, fast, deterministic 32-bit PRNG. State is a plain integer so it serializes. */
export function rngNext(state: number): { state: number; value: number } {
  let a = (state + 0x6d2b79f5) | 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = (t ^ (t >>> 14)) >>> 0;
  return { state: a, value };
}

export class Rng {
  constructor(public state: number) {
    this.state = state | 0;
  }
  /** Returns integer in [0, n). */
  int(n: number): number {
    const r = rngNext(this.state);
    this.state = r.state;
    return n <= 0 ? 0 : r.value % n;
  }
  chance(percent: number): boolean {
    return this.int(100) < percent;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)];
  }
}

export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
