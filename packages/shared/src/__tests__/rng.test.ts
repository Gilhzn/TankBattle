import { describe, expect, it } from 'vitest';
import { Rng, hashString } from '../rng.js';

describe('rng', () => {
  it('is deterministic for a seed', () => {
    const a = new Rng(123);
    const b = new Rng(123);
    const seqA = Array.from({ length: 50 }, () => a.int(1000));
    const seqB = Array.from({ length: 50 }, () => b.int(1000));
    expect(seqA).toEqual(seqB);
  });
  it('produces values in range with a reasonable spread', () => {
    const r = new Rng(7);
    const counts = new Array(4).fill(0);
    for (let i = 0; i < 4000; i++) counts[r.int(4)]++;
    for (const c of counts) expect(c).toBeGreaterThan(800);
  });
  it('hashString is stable', () => {
    expect(hashString('tank')).toBe(hashString('tank'));
    expect(hashString('tank')).not.toBe(hashString('tanks'));
  });
});
