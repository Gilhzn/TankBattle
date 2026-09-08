import { createServer, type Server } from 'node:http';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import type { App } from './app.js';
import { verify } from './auth/tokens.js';
import { UserService } from './auth/users.js';
import { AccountService } from './auth/accounts.js';
import { GoogleVerifier } from './auth/google.js';
import { createMailer, type Mailer } from './auth/mailer.js';
import type { MxLookup } from './auth/email.js';
import { FriendsService } from './social/friends.js';
import { Presence } from './social/presence.js';
import { RankingService } from './social/ranking.js';
import { Matchmaker } from './rooms/matchmaker.js';
import { LlmChatResponder, ScriptedChatResponder, type ChatResponder } from './game/botChat.js';
import { loadConfig, type Config } from './config.js';
import { openDb } from './db/index.js';
import type { LedgerCurrency, UserRow } from './db/repo.js';
import { BattlepassService } from './economy/battlepass.js';
import { GiftsService } from './economy/gifts.js';
import { InventoryService } from './economy/inventory.js';
import { StoreService } from './economy/orders.js';
import { MockProvider } from './economy/payments/mock.js';
import type { PaymentProvider } from './economy/payments/provider.js';
import { StripeProvider } from './economy/payments/stripe.js';
import { RewardsService } from './economy/rewards.js';
import { WalletService } from './economy/wallet.js';
import { ResultsService } from './game/results.js';
import { GameRunner } from './game/runner.js';
import { SoloService } from './game/solo.js';
import { Router, type RouterDeps } from './http/router.js';
import { registerRoutes } from './http/routes/index.js';
import { serveStatic } from './http/static.js';
import { RoomManager } from './rooms/roomManager.js';
import { createLogger, type LogLevel } from './util/log.js';
import type { Clock } from './util/time.js';
import { Gateway } from './ws/gateway.js';

export interface StartOptions {
  port?: number;
  dbPath?: string;
  secret?: string;
  provider?: 'mock' | 'stripe';
  /** `null` disables static file serving. */
  staticDir?: string | null;
  tickRate?: number;
  snapshotEvery?: number;
  fullSnapshotEvery?: number;
  countdownMs?: number;
  quickPlayWaitMs?: number;
  disconnectGraceMs?: number;
  logLevel?: LogLevel;
  /** Injectable clock for time-dependent economy rules. */
  clock?: Clock;
  /** Injectable mailer so tests can read verification codes without sending email. */
  mailer?: Mailer;
  /** Injectable MX lookup so tests do not depend on DNS. */
  mx?: MxLookup;
  /** Overrides the request rate limits. Tests raise them because they all share one IP. */
  limits?: RouterDeps['limits'];
  /** Exposes `debug` helpers (tests only). */
  debug?: boolean;
  config?: Partial<Config>;
}

export interface DebugApi {
  credit(userId: string, currency: LedgerCurrency, amount: number): void;
  app: App;
}

export interface RunningServer {
  port: number;
  url: string;
  wsUrl: string;
  app: App;
  debug?: DebugApi;
  close(): Promise<void>;
}

const DEFAULT_STATIC = resolve(dirname(fileURLToPath(import.meta.url)), '../../client/dist');

/** Wires config → db → services → http/ws and listens. Tests start it on port 0 with an in-memory db. */
export async function startServer(opts: StartOptions = {}): Promise<RunningServer> {
  const config: Config = { ...loadConfig(), ...opts.config };
  if (opts.port !== undefined) config.port = opts.port;
  if (opts.dbPath !== undefined) config.dbPath = opts.dbPath;
  if (opts.secret !== undefined) {
    config.secret = opts.secret;
    config.secretGenerated = false;
  }
  if (opts.provider !== undefined) config.provider = opts.provider;
  if (opts.staticDir !== undefined) config.staticDir = opts.staticDir;
  else if (config.staticDir === null) config.staticDir = DEFAULT_STATIC;
  if (opts.tickRate !== undefined) config.tickRate = opts.tickRate;
  if (opts.snapshotEvery !== undefined) config.snapshotEvery = opts.snapshotEvery;
  if (opts.fullSnapshotEvery !== undefined) config.fullSnapshotEvery = opts.fullSnapshotEvery;
  if (opts.countdownMs !== undefined) config.countdownMs = opts.countdownMs;
  if (opts.logLevel !== undefined) config.logLevel = opts.logLevel;

  const log = createLogger(config.logLevel, 'server');
  if (config.secretGenerated) log.warn('SECRET is not set: tokens will not survive a restart');
  const clock: Clock = opts.clock ?? (() => Date.now());
  const db = openDb(config.dbPath, log);
  log.info(`database: ${db.kind} (${config.dbPath})`);
  // A relative path lives in the container's writable layer, which most hosts throw away on every
  // restart and deploy. That is a legitimate choice for a free tier, but it should never be a
  // surprise — accounts, friends lists, ratings and wallets all go with it.
  if (config.dbPath !== ':memory:' && !isAbsolute(config.dbPath.replace(/^json:/, ''))) {
    log.warn(`DB_PATH=${config.dbPath} is a relative path: if this host has no persistent disk mounted, all accounts, friends and ratings reset on every restart`);
  }

  const users = new UserService(db, config.secret, clock);
  const presence = new Presence(clock);
  const mailer = opts.mailer ?? createMailer(
    { provider: config.mail.provider ?? undefined, apiKey: config.mail.apiKey ?? undefined, from: config.mail.from ?? undefined, endpoint: config.mail.endpoint ?? undefined },
    log.child('mail'),
  );
  const google = config.googleClientId ? new GoogleVerifier({ clientId: config.googleClientId, now: clock }) : undefined;
  if (!google) log.warn('GOOGLE_CLIENT_ID is not set: sign in with Google is unavailable');
  const accounts = new AccountService({ db, users, secret: config.secret, clock, log: log.child('auth'), mailer, google, mx: opts.mx });
  const ranking = new RankingService({ db, clock });
  const friends = new FriendsService({ db, clock, presence, secret: config.secret, publicUrl: config.publicUrl });
  const wallet = new WalletService(db, clock);
  const inventory = new InventoryService(db);
  const battlepass = new BattlepassService(db, wallet, inventory, clock);
  const provider: PaymentProvider =
    config.provider === 'stripe' && config.stripeSecretKey && config.stripeWebhookSecret
      ? new StripeProvider(config.stripeSecretKey, config.stripeWebhookSecret, config.publicUrl ?? `http://localhost:${config.port}`, clock)
      : new MockProvider();
  if (config.provider === 'stripe' && provider.name !== 'stripe') log.warn('provider=stripe requested but STRIPE_* keys are missing; using mock');
  const store = new StoreService(db, wallet, inventory, battlepass, provider, clock);
  const rewards = new RewardsService(db, wallet, inventory, clock);
  const gifts = new GiftsService(db, wallet, inventory, clock);
  const results = new ResultsService(db, wallet, battlepass, clock);
  const solo = new SoloService(db, wallet, inventory, battlepass, results, clock);
  const rooms = new RoomManager({
    clock,
    log: log.child('rooms'),
    countdownMs: config.countdownMs,
    quickPlayWaitMs: opts.quickPlayWaitMs,
    disconnectGraceMs: opts.disconnectGraceMs,
    createRunner: (room) =>
      new GameRunner(room, { inventory, wallet, results, ranking, log: log.child('game'), tickRate: config.tickRate, snapshotEvery: config.snapshotEvery, fullSnapshotEvery: config.fullSnapshotEvery }),
  });

  const authenticate = (token: string): UserRow | null => {
    const payload = verify(config.secret, token, clock());
    return payload ? (db.users.get(payload.sub) ?? null) : null;
  };

  const chatResponder: ChatResponder = process.env.BOT_CHAT_API_KEY
    ? new LlmChatResponder({ apiKey: process.env.BOT_CHAT_API_KEY, log: log.child('botchat'), fallback: new ScriptedChatResponder() })
    : new ScriptedChatResponder();
  const matchmaker = new Matchmaker({
    rooms,
    clock,
    log: log.child('ranked'),
    botTimeoutMs: config.matchmakingTimeoutMs,
    chatResponder,
    onMatched: (ticket, room) => ticket.link.send({ type: 'matchFound', roomId: room.id }),
  });

  const app: App = {
    config, log, clock, db, users, accounts, friends, ranking, presence, authenticate, matchmaker,
    wallet, inventory, store, battlepass, rewards, gifts, results, solo, provider, rooms, startedAt: Date.now(),
  };

  const router = new Router({ log, clock, authenticate, limits: opts.limits });
  registerRoutes(router, app);

  const server: Server = createServer((req, res) => {
    router
      .handle(req, res)
      .then((handled) => {
        if (handled) return;
        if (config.staticDir) serveStatic(config.staticDir, req, res);
        else res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
      })
      .catch((err) => {
        log.error('request failed', err);
        if (!res.headersSent) res.writeHead(500).end();
      });
  });
  const gateway = new Gateway(server, {
    clock, log: log.child('ws'), rooms, matchmaker, ranking, presence,
    tickRate: config.tickRate, snapshotRate: config.tickRate / config.snapshotEvery, authenticate,
  });

  await new Promise<void>((res, rej) => {
    server.once('error', rej);
    server.listen(config.port, () => {
      server.off('error', rej);
      res();
    });
  });
  const port = (server.address() as AddressInfo).port;
  log.info(`listening on http://localhost:${port} (provider=${provider.name}, tickRate=${config.tickRate})`);

  const running: RunningServer = {
    port,
    url: `http://localhost:${port}`,
    wsUrl: `ws://localhost:${port}/ws`,
    app,
    close: async () => {
      rooms.close();
      await gateway.close();
      await new Promise<void>((res) => server.close(() => res()));
      server.closeAllConnections();
      db.close();
      log.info('stopped');
    },
  };
  if (opts.debug) {
    running.debug = { app, credit: (userId, currency, amount) => void wallet.credit(userId, currency, amount, 'debug') };
  }
  return running;
}
