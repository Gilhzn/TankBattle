import { notFound } from '../../util/errors.js';
import type { App } from '../../app.js';
import type { Router } from '../router.js';

/** A player's public card: who they are, how they rank, and how they are doing right now. */
function publicProfile(app: App, userId: string, viewerId?: string) {
  const u = app.db.users.get(userId);
  if (!u) throw notFound('no such player', 'player_not_found');
  const presence = app.presence.of(u.id, u.lastSeen);
  return {
    id: u.id,
    nickname: u.nickname,
    skin: u.skin,
    country: u.country,
    createdAt: u.createdAt,
    presence,
    rating: app.ranking.profile(u.id),
    stats: app.db.matches.stats(u.id),
    // Only meaningful to a signed-in viewer, and only about their own relationship to this player.
    isFriend: viewerId ? app.db.friends.has(viewerId, u.id) : false,
    isSelf: viewerId === u.id,
  };
}

export function registerProfileRoutes(r: Router, app: App): void {
  /** The signed-in player's own profile. */
  r.get('/api/me/profile', (ctx) => publicProfile(app, ctx.user.id, ctx.user.id));

  /** Somebody else's, by id — reachable from the friends list and the leaderboard. */
  r.get('/api/players/:id/profile', (ctx) => publicProfile(app, ctx.params.id, ctx.user.id));

  /** Or by nickname, which is what a player actually knows about their friends. */
  r.get('/api/players/by-nickname/:nickname', (ctx) => {
    const u = app.db.users.getByNickname(decodeURIComponent(ctx.params.nickname).toLowerCase());
    if (!u) throw notFound('no player with that nickname', 'player_not_found');
    return publicProfile(app, u.id, ctx.user.id);
  });

  /**
   * The ranked ladder. `scope=country` uses the viewer's own country, so a player sees where they
   * stand at home without having to know their own country code.
   */
  r.get('/api/ranked/leaderboard', (ctx) => {
    const limit = Math.min(100, Math.max(1, Number(ctx.query.get('limit') ?? 50) || 50));
    const scope = ctx.query.get('scope') === 'country' ? 'country' : 'world';
    const country = scope === 'country' ? (ctx.query.get('country') ?? ctx.user.country) : undefined;
    if (scope === 'country' && !country) return { scope, country: '', entries: [], me: app.ranking.profile(ctx.user.id) };
    return {
      scope,
      country: country ?? '',
      entries: app.ranking.leaderboard(limit, country || undefined),
      me: app.ranking.profile(ctx.user.id),
    };
  }, { cost: 2 });
}
