import { randomBytes } from 'node:crypto';
import type { LogLevel } from './util/log.js';

export interface Config {
  port: number;
  secret: string;
  secretGenerated: boolean;
  dbPath: string;
  provider: 'mock' | 'stripe';
  stripeSecretKey: string | null;
  stripeWebhookSecret: string | null;
  publicUrl: string | null;
  tickRate: number;
  snapshotEvery: number;
  fullSnapshotEvery: number;
  staticDir: string | null;
  logLevel: LogLevel;
  /** Lobby countdown before `gameStart` (ms). */
  countdownMs: number;
  /** Google OAuth client id. Google sign-in is offered only when this is set. */
  googleClientId: string | null;
  /** Transactional email, for verification codes. Without it codes only reach the server log. */
  mail: { provider: string | null; apiKey: string | null; from: string | null; endpoint: string | null };
  /**
   * How long a player may sit in the ranked queue before the game fills the empty seats itself.
   * A range, not a number: each search draws its own wait, so the moment the opponents appear is
   * never the same twice and never reads as a scripted countdown.
   */
  matchmakingFill: { minMs: number; maxMs: number };
}

const int = (v: string | undefined, dflt: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : dflt;
};

/**
 * The window a search waits in before the game fills the seats. `MATCHMAKING_TIMEOUT_MS` is the
 * older single-value form and still works: it pins both ends together, which is what tests want
 * when they need the wait to be exact rather than lifelike.
 */
function fillRange(env: NodeJS.ProcessEnv): { minMs: number; maxMs: number } {
  if (env.MATCHMAKING_TIMEOUT_MS) {
    const fixed = int(env.MATCHMAKING_TIMEOUT_MS, 9_000);
    return { minMs: fixed, maxMs: fixed };
  }
  const minMs = int(env.MATCHMAKING_FILL_MIN_MS, 9_000);
  const maxMs = int(env.MATCHMAKING_FILL_MAX_MS, 17_000);
  return { minMs, maxMs: Math.max(minMs, maxMs) };
}

/** Builds the runtime config from environment variables (with documented defaults). */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const secret = env.SECRET && env.SECRET.length >= 16 ? env.SECRET : null;
  const stripeSecretKey = env.STRIPE_SECRET_KEY || null;
  const stripeWebhookSecret = env.STRIPE_WEBHOOK_SECRET || null;
  return {
    port: int(env.PORT, 8080),
    secret: secret ?? randomBytes(32).toString('base64url'),
    secretGenerated: secret === null,
    dbPath: env.DB_PATH || '.data/tank.db',
    provider: stripeSecretKey && stripeWebhookSecret ? 'stripe' : 'mock',
    stripeSecretKey,
    stripeWebhookSecret,
    publicUrl: env.PUBLIC_URL || null,
    tickRate: int(env.TICK_RATE, 30),
    snapshotEvery: int(env.SNAPSHOT_EVERY, 2),
    fullSnapshotEvery: int(env.FULL_SNAPSHOT_EVERY, 60),
    staticDir: env.STATIC_DIR === '' ? null : (env.STATIC_DIR ?? null),
    logLevel: (env.LOG_LEVEL as LogLevel) || 'info',
    countdownMs: int(env.COUNTDOWN_MS, 3000),
    googleClientId: env.GOOGLE_CLIENT_ID || null,
    mail: {
      provider: env.MAIL_PROVIDER || null,
      apiKey: env.MAIL_API_KEY || null,
      from: env.MAIL_FROM || null,
      endpoint: env.MAIL_ENDPOINT || null,
    },
    matchmakingFill: fillRange(env),
  };
}
