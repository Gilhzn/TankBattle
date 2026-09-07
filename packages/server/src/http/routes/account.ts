import { emailStartSchema, emailVerifySchema, googleAuthSchema, nicknameCheckSchema } from '@tank/shared';
import type { App } from '../../app.js';
import { userDto } from '../../auth/users.js';
import { parseBody, type Ctx, type Router } from '../router.js';

/**
 * Best-effort country for the national leaderboard.
 *
 * Preference order: what the client told us, then the CDN's geo header if there is one, then the
 * country subtag of the browser's language. All three are hints, not identity — the leaderboard is
 * a fun statistic, not a border control, so a wrong guess costs nothing and the player can correct
 * it from their profile.
 */
export function guessCountry(ctx: Ctx, given?: string): string | undefined {
  const norm = (v: string | undefined): string | undefined => {
    const c = (v ?? '').trim().toUpperCase();
    return /^[A-Z]{2}$/.test(c) ? c : undefined;
  };
  const header = (name: string): string | undefined => {
    const v = ctx.headers[name];
    return Array.isArray(v) ? v[0] : v;
  };
  return (
    norm(given) ??
    norm(header('cf-ipcountry')) ??
    norm(header('x-vercel-ip-country')) ??
    norm(header('fly-client-ip-country')) ??
    // "he-IL" / "en-GB" -> IL / GB. A bare "en" has no country and is skipped.
    norm(/^[a-z]{2,3}-([A-Za-z]{2})\b/.exec(String(header('accept-language') ?? ''))?.[1])
  );
}

export function registerAccountRoutes(r: Router, app: App): void {
  /** Which sign-in methods this deployment can actually offer. */
  r.get('/api/auth/methods', () => ({
    google: !!app.config.googleClientId,
    googleClientId: app.config.googleClientId,
    email: true,
    // Honest about the dev fallback: the client shows a hint rather than pretending mail was sent.
    emailDelivers: !!app.config.mail.provider,
  }), { auth: false });

  r.post('/api/auth/google', async (ctx) => {
    const body = parseBody(googleAuthSchema, ctx.body);
    // A bearer token here means a guest upgrading in place, so their progress carries over.
    const linkTo = currentUserId(ctx, app);
    return app.accounts.google(body.idToken, linkTo, guessCountry(ctx, body.country));
  }, { auth: false, cost: 4 });

  r.post('/api/auth/email/start', async (ctx) => {
    const body = parseBody(emailStartSchema, ctx.body);
    return app.accounts.startEmail(body.email, currentUserId(ctx, app), body.lang);
  }, { auth: false, cost: 6 });

  r.post('/api/auth/email/verify', (ctx) => {
    const body = parseBody(emailVerifySchema, ctx.body);
    return app.accounts.verifyEmail(body.email, body.code, guessCountry(ctx, body.country));
  }, { auth: false, cost: 4 });

  r.get('/api/auth/nickname', (ctx) => {
    const nickname = ctx.query.get('nickname') ?? '';
    const parsed = nicknameCheckSchema.safeParse({ nickname });
    if (!parsed.success) return { available: false, reason: 'invalid' };
    return app.users.nicknameAvailable(parsed.data.nickname, currentUserId(ctx, app));
  }, { auth: false, cost: 1 });

  /** The signed-in player's account: how they sign in, and whether the account survives this device. */
  r.get('/api/me/account', (ctx) => ({
    user: userDto(ctx.user),
    identities: app.accounts.identities(ctx.user.id),
    registered: app.accounts.isRegistered(ctx.user.id),
  }));
}

/**
 * The user behind an optional bearer token. These routes are `auth: false` because a signed-out
 * player must be able to reach them, but a signed-in one gets their guest account linked rather
 * than abandoned, so the token is read when it is there.
 */
function currentUserId(ctx: Ctx, app: App): string | undefined {
  const header = ctx.headers.authorization;
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw?.startsWith('Bearer ')) return undefined;
  return app.authenticate(raw.slice(7))?.id;
}
