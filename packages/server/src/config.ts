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
}

const int = (v: string | undefined, dflt: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : dflt;
};

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
  };
}
