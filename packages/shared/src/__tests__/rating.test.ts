import { describe, expect, it } from 'vitest';
import {
  applyRating, arenaIndexForRating, ARENAS, expectedScore, MIN_RATING, ratingBand, ratingDelta, ratingTier, STARTING_RATING, teamRating,
} from '../index.js';

describe('rating', () => {
  it('starts everyone at 1000', () => {
    expect(STARTING_RATING).toBe(1000);
  });

  it('pays 10 for beating an equal opponent', () => {
    expect(ratingDelta(1000, 1000, 1)).toBe(10);
  });

  it('pays 9 for a slightly weaker opponent and 11 for a slightly stronger one', () => {
    // "Slightly" is the ~35 points either side of even that K=20 maps onto 9 and 11.
    expect(ratingDelta(1000, 965, 1)).toBe(9);
    expect(ratingDelta(1000, 1035, 1)).toBe(11);
  });

  it('mirrors on a loss: less is lost to a stronger opponent, more to a weaker one', () => {
    expect(ratingDelta(1000, 1000, 0)).toBe(-10);
    expect(ratingDelta(1000, 1035, 0)).toBe(-9);
    expect(ratingDelta(1000, 965, 0)).toBe(-11);
  });

  it('always moves at least a point, even in a hopeless mismatch', () => {
    expect(ratingDelta(2000, 100, 1)).toBe(1);
    expect(ratingDelta(100, 2000, 0)).toBe(-1);
  });

  it('is zero-sum between the two players', () => {
    for (const [a, b] of [[1000, 1000], [1200, 900], [1000, 1035], [1500, 1499]]) {
      expect(ratingDelta(a, b, 1) + ratingDelta(b, a, 0)).toBe(0);
    }
  });

  it('never falls below the floor', () => {
    let r = 120;
    for (let i = 0; i < 50; i++) r = applyRating(r, 1500, 0);
    expect(r).toBe(MIN_RATING);
  });

  it('scores a draw as no change between equals', () => {
    expect(ratingDelta(1000, 1000, 0.5)).toBe(0);
  });

  it('reads the expected score off the Elo curve', () => {
    expect(expectedScore(1000, 1000)).toBeCloseTo(0.5, 6);
    expect(expectedScore(1400, 1000)).toBeCloseTo(0.909, 3);
  });

  it('scores a 2v2 against the average of the other side', () => {
    expect(teamRating([1000, 1200])).toBe(1100);
    expect(teamRating([])).toBe(STARTING_RATING);
  });

  it('names a tier for every rating', () => {
    expect(ratingTier(1000)).toBe('silver');
    expect(ratingTier(1100)).toBe('gold');
    expect(ratingTier(1700)).toBe('master');
    expect(ratingTier(0)).toBe('bronze');
  });
});

describe('rating bands pick the arena', () => {
  it('changes band every 100 points', () => {
    expect(ratingBand(999)).toBe(9);
    expect(ratingBand(1000)).toBe(10);
    expect(ratingBand(1099)).toBe(10);
    expect(ratingBand(1100)).toBe(11);
  });

  it('gives a different arena to each 100-point step', () => {
    const seen = new Set<number>();
    for (let r = 1000; r < 1000 + 100 * ARENAS.length; r += 100) seen.add(arenaIndexForRating(r));
    expect(seen.size).toBe(ARENAS.length);
  });

  it('keeps the same arena within a band', () => {
    expect(arenaIndexForRating(1000)).toBe(arenaIndexForRating(1099));
    expect(arenaIndexForRating(1100)).not.toBe(arenaIndexForRating(1099));
  });

  it('wraps rather than falling off the end at very high ratings', () => {
    expect(arenaIndexForRating(50_000)).toBeGreaterThanOrEqual(0);
    expect(arenaIndexForRating(50_000)).toBeLessThan(ARENAS.length);
  });
});
