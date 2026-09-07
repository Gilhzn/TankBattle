import { applyRating, ratingTier, STARTING_RATING, teamRating, type RatingTier } from '@tank/shared';
import type { Db, RatingRow } from '../db/repo.js';
import type { Clock } from '../util/time.js';

export interface RankInfo {
  /** 1-based position. 0 when the player is unrated. */
  position: number;
  /** How many players the position is out of. */
  of: number;
}

export interface RatingProfile {
  rating: number;
  best: number;
  tier: RatingTier;
  wins: number;
  losses: number;
  draws: number;
  matches: number;
  world: RankInfo;
  country: RankInfo;
  countryCode: string;
}

export interface LeaderboardEntry {
  position: number;
  userId: string;
  nickname: string;
  country: string;
  rating: number;
  tier: RatingTier;
  wins: number;
  losses: number;
}

/** One player's outcome in a ranked match. */
export interface RankedOutcome {
  userId: string;
  /** Team the player fought for. */
  team: number;
  won: boolean;
  drew: boolean;
}

export interface RankingDeps {
  db: Db;
  clock: Clock;
}

/** Versus standings: ratings, win/loss records, and where a player sits at home and in the world. */
export class RankingService {
  constructor(private readonly deps: RankingDeps) {}

  /** The player's rating row, materialised at the starting rating if they have never played ranked. */
  private rowFor(userId: string): RatingRow {
    return (
      this.deps.db.ratings.get(userId) ?? {
        userId, rating: STARTING_RATING, wins: 0, losses: 0, draws: 0, best: STARTING_RATING, matches: 0, updatedAt: 0,
      }
    );
  }

  rating(userId: string): number {
    return this.rowFor(userId).rating;
  }

  /**
   * Where a player stands. Rank is "how many are above me, plus one", so equal ratings share a
   * position rather than being ordered arbitrarily.
   */
  profile(userId: string): RatingProfile {
    const row = this.rowFor(userId);
    const country = this.deps.db.users.get(userId)?.country ?? '';
    const rated = row.matches > 0;
    return {
      rating: row.rating,
      best: row.best,
      tier: ratingTier(row.rating),
      wins: row.wins,
      losses: row.losses,
      draws: row.draws,
      matches: row.matches,
      countryCode: country,
      world: rated
        ? { position: this.deps.db.ratings.countAbove(row.rating) + 1, of: this.deps.db.ratings.countRated() }
        : { position: 0, of: this.deps.db.ratings.countRated() },
      country:
        rated && country
          ? { position: this.deps.db.ratings.countAbove(row.rating, country) + 1, of: this.deps.db.ratings.countRated(country) }
          : { position: 0, of: country ? this.deps.db.ratings.countRated(country) : 0 },
    };
  }

  leaderboard(limit = 50, country?: string): LeaderboardEntry[] {
    return this.deps.db.ratings.top(limit, country).map((r, i) => ({
      position: i + 1,
      userId: r.userId,
      nickname: r.nickname,
      country: r.country,
      rating: r.rating,
      tier: ratingTier(r.rating),
      wins: r.wins,
      losses: r.losses,
    }));
  }

  /**
   * Applies one ranked match to everyone in it.
   *
   * Each player is scored against the average rating of the side they were up against, so a 2v2 is
   * rated the same way a duel is: carrying a weaker partner against a stronger pair pays more.
   * Bots are simply absent from `outcomes` — they have no row to update, and their rating still
   * counts towards the human's opponent average via `opponentRatings`.
   */
  record(outcomes: RankedOutcome[], opponentRatings?: Map<number, number[]>): Map<string, { before: number; after: number; delta: number }> {
    const changes = new Map<string, { before: number; after: number; delta: number }>();
    if (outcomes.length < 2 && !opponentRatings) return changes;

    // Ratings by team, so each player can be scored against the other side's average.
    const byTeam = opponentRatings ?? new Map<number, number[]>();
    if (!opponentRatings) {
      for (const o of outcomes) {
        const list = byTeam.get(o.team) ?? [];
        list.push(this.rowFor(o.userId).rating);
        byTeam.set(o.team, list);
      }
    }

    const now = this.deps.clock();
    this.deps.db.transaction(() => {
      for (const o of outcomes) {
        const row = this.rowFor(o.userId);
        const opponents = [...byTeam.entries()].filter(([team]) => team !== o.team).flatMap(([, r]) => r);
        if (!opponents.length) continue;
        const score = o.drew ? 0.5 : o.won ? 1 : 0;
        const after = applyRating(row.rating, teamRating(opponents), score);
        this.deps.db.ratings.put({
          userId: o.userId,
          rating: after,
          wins: row.wins + (o.won && !o.drew ? 1 : 0),
          losses: row.losses + (!o.won && !o.drew ? 1 : 0),
          draws: row.draws + (o.drew ? 1 : 0),
          best: Math.max(row.best, after),
          matches: row.matches + 1,
          updatedAt: now,
        });
        changes.set(o.userId, { before: row.rating, after, delta: after - row.rating });
      }
    });
    return changes;
  }
}
