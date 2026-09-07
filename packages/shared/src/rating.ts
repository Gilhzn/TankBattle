/**
 * Versus rating. Standard Elo with K = 20, which is exactly the curve the game promises: an even
 * match moves 10 points, beating someone a little weaker pays 9, and beating someone a little
 * stronger pays 11. Losses mirror it — you shed less when you lose to a stronger player.
 */

/** Every new player starts here. */
export const STARTING_RATING = 1000;
/** Rating never drops below this, so a losing streak cannot bury an account. */
export const MIN_RATING = 100;
/** How far one result may move a rating. 20 gives the 9 / 10 / 11 spread the design calls for. */
export const RATING_K = 20;
/** A new arena every this many rating points. */
export const RATING_BAND = 100;

/** Probability that `rating` beats `opponent`, on the Elo logistic curve. */
export function expectedScore(rating: number, opponent: number): number {
  return 1 / (1 + 10 ** ((opponent - rating) / 400));
}

/**
 * Rating change for one result. `score` is 1 for a win, 0 for a loss, 0.5 for a draw.
 * Always moves at least a point in the right direction, so even a hopeless mismatch counts.
 */
export function ratingDelta(rating: number, opponent: number, score: 0 | 0.5 | 1, k = RATING_K): number {
  const raw = k * (score - expectedScore(rating, opponent));
  const rounded = Math.round(raw);
  if (score === 0.5) return rounded;
  if (score === 1) return Math.max(1, rounded);
  return Math.min(-1, rounded);
}

/** The new rating after one result, floored at MIN_RATING. */
export function applyRating(rating: number, opponent: number, score: 0 | 0.5 | 1, k = RATING_K): number {
  return Math.max(MIN_RATING, rating + ratingDelta(rating, opponent, score, k));
}

/** Mean rating of a side — the figure a 2v2 result is scored against. */
export function teamRating(ratings: number[]): number {
  if (!ratings.length) return STARTING_RATING;
  return Math.round(ratings.reduce((a, r) => a + r, 0) / ratings.length);
}

/**
 * Which rating band a player is in. Band 0 is everything below the first boundary; the band index
 * chooses the arena, so climbing 100 points visibly changes where you play.
 */
export function ratingBand(rating: number): number {
  return Math.max(0, Math.floor(rating / RATING_BAND));
}

/** Human-facing tier name for a rating, for the profile and the match screen. */
export type RatingTier = 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond' | 'master';

const TIER_FLOORS: Array<[number, RatingTier]> = [
  [1600, 'master'],
  [1400, 'diamond'],
  [1250, 'platinum'],
  [1100, 'gold'],
  [950, 'silver'],
  [0, 'bronze'],
];

export function ratingTier(rating: number): RatingTier {
  for (const [floor, tier] of TIER_FLOORS) if (rating >= floor) return tier;
  return 'bronze';
}
