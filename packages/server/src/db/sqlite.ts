import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type BetterSqlite3 from 'better-sqlite3';
import {
  bestPerUserOf, statsOf,
  type AdSessionRow, type BattlepassRow, type DailyRow, type Db, type GiftRow, type InventoryRow, type LedgerRow, type MatchResultRow,
  type OrderRow, type SoloClaimRow, type SoloSessionRow, type UserRow, type WalletRow,
  type AuthProvider, type EmailCodeRow, type FriendRequestRow, type FriendRow, type IdentityRow, type RatingRow,
} from './repo.js';

type SqliteCtor = typeof BetterSqlite3;
type Row = Record<string, unknown>;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, device_hash TEXT NOT NULL UNIQUE, nickname TEXT NOT NULL, nickname_lc TEXT NOT NULL UNIQUE,
  skin TEXT NOT NULL DEFAULT 'default', settings TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL,
  country TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS wallets (user_id TEXT PRIMARY KEY, coins INTEGER NOT NULL DEFAULT 0, gems INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS ledger (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, currency TEXT NOT NULL, amount INTEGER NOT NULL, balance_after INTEGER NOT NULL,
  reason TEXT NOT NULL, ref TEXT, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS ledger_user ON ledger(user_id, created_at);
CREATE TABLE IF NOT EXISTS inventory (user_id TEXT NOT NULL, sku TEXT NOT NULL, qty INTEGER NOT NULL, equipped INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(user_id, sku));
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, sku TEXT NOT NULL, provider TEXT NOT NULL, status TEXT NOT NULL,
  amount_cents INTEGER NOT NULL, currency TEXT NOT NULL, provider_ref TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS orders_user ON orders(user_id, created_at);
CREATE TABLE IF NOT EXISTS gifts (
  id TEXT PRIMARY KEY, from_id TEXT NOT NULL, to_id TEXT NOT NULL, sku TEXT NOT NULL, qty INTEGER NOT NULL, message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL, created_at INTEGER NOT NULL, claimed_at INTEGER);
CREATE INDEX IF NOT EXISTS gifts_to ON gifts(to_id, status);
CREATE INDEX IF NOT EXISTS gifts_from ON gifts(from_id, created_at);
CREATE TABLE IF NOT EXISTS battlepass (
  user_id TEXT NOT NULL, season INTEGER NOT NULL, xp INTEGER NOT NULL DEFAULT 0, premium INTEGER NOT NULL DEFAULT 0,
  claimed_free TEXT NOT NULL DEFAULT '[]', claimed_premium TEXT NOT NULL DEFAULT '[]', PRIMARY KEY(user_id, season));
CREATE TABLE IF NOT EXISTS daily_rewards (user_id TEXT PRIMARY KEY, streak INTEGER NOT NULL DEFAULT 0, last_claim_day INTEGER, last_claim_at INTEGER);
CREATE TABLE IF NOT EXISTS ad_sessions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, placement TEXT NOT NULL, day INTEGER NOT NULL, started_at INTEGER NOT NULL,
  completed_at INTEGER, match_result_id TEXT, coins INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS ads_user_day ON ad_sessions(user_id, day);
CREATE TABLE IF NOT EXISTS match_results (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, mode TEXT NOT NULL, score INTEGER NOT NULL, stage INTEGER NOT NULL,
  kills INTEGER NOT NULL, coins INTEGER NOT NULL, xp INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS matches_user ON match_results(user_id, created_at);
CREATE INDEX IF NOT EXISTS matches_mode_score ON match_results(mode, score DESC);
CREATE TABLE IF NOT EXISTS solo_sessions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, seed INTEGER NOT NULL, stage INTEGER NOT NULL, boosts TEXT NOT NULL DEFAULT '[]',
  difficulty TEXT NOT NULL DEFAULT 'normal', created_at INTEGER NOT NULL, consumed_at INTEGER);
CREATE TABLE IF NOT EXISTS solo_claims (user_id TEXT NOT NULL, day INTEGER NOT NULL, coins INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(user_id, day));
CREATE TABLE IF NOT EXISTS identities (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, provider TEXT NOT NULL, subject TEXT NOT NULL, email TEXT NOT NULL DEFAULT '',
  email_verified INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, last_login_at INTEGER NOT NULL,
  UNIQUE(provider, subject));
CREATE INDEX IF NOT EXISTS identities_user ON identities(user_id);
CREATE TABLE IF NOT EXISTS email_codes (
  email TEXT PRIMARY KEY, code_hash TEXT NOT NULL, user_id TEXT, expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS friends (
  user_id TEXT NOT NULL, friend_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(user_id, friend_id));
CREATE INDEX IF NOT EXISTS friends_user ON friends(user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS friend_requests (
  id TEXT PRIMARY KEY, from_id TEXT NOT NULL, to_id TEXT NOT NULL, status TEXT NOT NULL,
  created_at INTEGER NOT NULL, responded_at INTEGER);
CREATE INDEX IF NOT EXISTS freq_to ON friend_requests(to_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS freq_from ON friend_requests(from_id, status, created_at DESC);
CREATE TABLE IF NOT EXISTS ratings (
  user_id TEXT PRIMARY KEY, rating INTEGER NOT NULL, wins INTEGER NOT NULL DEFAULT 0, losses INTEGER NOT NULL DEFAULT 0,
  draws INTEGER NOT NULL DEFAULT 0, best INTEGER NOT NULL, matches INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS ratings_rank ON ratings(rating DESC);
CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);
`;

const SCHEMA_VERSION = 2;

/** Applies idempotent migrations. New versions append statements guarded by the stored version. */
function migrate(db: BetterSqlite3.Database): void {
  db.exec(SCHEMA);
  const row = db.prepare('SELECT version FROM schema_version LIMIT 1').get() as { version: number } | undefined;
  const from = row?.version ?? 0;
  // v2 adds accounts, friends and ratings. The new tables come from SCHEMA above; only columns
  // added to an existing table need an explicit ALTER, and it has to tolerate a fresh database
  // where SCHEMA already created the column.
  if (from < 2) addColumn(db, 'users', 'country', "TEXT NOT NULL DEFAULT ''");
  if (!row) db.prepare('INSERT INTO schema_version(version) VALUES (?)').run(SCHEMA_VERSION);
  else if (row.version < SCHEMA_VERSION) db.prepare('UPDATE schema_version SET version = ?').run(SCHEMA_VERSION);
}

/** Adds a column unless it is already there, so migrations are safe to re-run. */
function addColumn(db: BetterSqlite3.Database, table: string, column: string, decl: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (cols.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
}

const str = (v: unknown) => v as string;
const num = (v: unknown) => v as number;
const nnum = (v: unknown) => (v === null || v === undefined ? null : (v as number));
const bool = (v: unknown) => v === 1 || v === true;
const json = <T>(v: unknown, dflt: T): T => {
  try {
    return typeof v === 'string' ? (JSON.parse(v) as T) : dflt;
  } catch {
    return dflt;
  }
};

const toUser = (r: Row): UserRow => ({
  id: str(r.id), deviceHash: str(r.device_hash), nickname: str(r.nickname), nicknameLc: str(r.nickname_lc), skin: str(r.skin),
  settings: json<Record<string, unknown>>(r.settings, {}), createdAt: num(r.created_at), lastSeen: num(r.last_seen),
  country: (r.country as string | null) ?? '',
});
const toIdentity = (r: Row): IdentityRow => ({
  id: str(r.id), userId: str(r.user_id), provider: r.provider as IdentityRow['provider'], subject: str(r.subject),
  email: str(r.email), emailVerified: bool(r.email_verified), createdAt: num(r.created_at), lastLoginAt: num(r.last_login_at),
});
const toEmailCode = (r: Row): EmailCodeRow => ({
  email: str(r.email), codeHash: str(r.code_hash), userId: (r.user_id as string | null) ?? null,
  expiresAt: num(r.expires_at), attempts: num(r.attempts), createdAt: num(r.created_at),
});
const toFriend = (r: Row): FriendRow => ({ userId: str(r.user_id), friendId: str(r.friend_id), createdAt: num(r.created_at) });
const toFriendReq = (r: Row): FriendRequestRow => ({
  id: str(r.id), fromId: str(r.from_id), toId: str(r.to_id), status: r.status as FriendRequestRow['status'],
  createdAt: num(r.created_at), respondedAt: nnum(r.responded_at),
});
const toRating = (r: Row): RatingRow => ({
  userId: str(r.user_id), rating: num(r.rating), wins: num(r.wins), losses: num(r.losses), draws: num(r.draws),
  best: num(r.best), matches: num(r.matches), updatedAt: num(r.updated_at),
});
const toRatingRanked = (r: Row): RatingRow & { nickname: string; country: string } => ({
  ...toRating(r), nickname: str(r.nickname), country: (r.country as string | null) ?? '',
});
const toWallet = (r: Row): WalletRow => ({ userId: str(r.user_id), coins: num(r.coins), gems: num(r.gems) });
const toLedger = (r: Row): LedgerRow => ({
  id: str(r.id), userId: str(r.user_id), currency: r.currency as LedgerRow['currency'], amount: num(r.amount), balanceAfter: num(r.balance_after),
  reason: str(r.reason), ref: (r.ref as string | null) ?? null, createdAt: num(r.created_at),
});
const toInv = (r: Row): InventoryRow => ({ userId: str(r.user_id), sku: str(r.sku), qty: num(r.qty), equipped: bool(r.equipped) });
const toOrder = (r: Row): OrderRow => ({
  id: str(r.id), userId: str(r.user_id), sku: str(r.sku), provider: r.provider as OrderRow['provider'], status: r.status as OrderRow['status'],
  amountCents: num(r.amount_cents), currency: 'usd', providerRef: (r.provider_ref as string | null) ?? null, createdAt: num(r.created_at), updatedAt: num(r.updated_at),
});
const toGift = (r: Row): GiftRow => ({
  id: str(r.id), fromId: str(r.from_id), toId: str(r.to_id), sku: str(r.sku), qty: num(r.qty), message: str(r.message),
  status: r.status as GiftRow['status'], createdAt: num(r.created_at), claimedAt: nnum(r.claimed_at),
});
const toBp = (r: Row): BattlepassRow => ({
  userId: str(r.user_id), season: num(r.season), xp: num(r.xp), premium: bool(r.premium),
  claimedFree: json<number[]>(r.claimed_free, []), claimedPremium: json<number[]>(r.claimed_premium, []),
});
const toDaily = (r: Row): DailyRow => ({ userId: str(r.user_id), streak: num(r.streak), lastClaimDay: nnum(r.last_claim_day), lastClaimAt: nnum(r.last_claim_at) });
const toAd = (r: Row): AdSessionRow => ({
  id: str(r.id), userId: str(r.user_id), placement: r.placement as AdSessionRow['placement'], day: num(r.day), startedAt: num(r.started_at),
  completedAt: nnum(r.completed_at), matchResultId: (r.match_result_id as string | null) ?? null, coins: num(r.coins),
});
const toMatch = (r: Row): MatchResultRow => ({
  id: str(r.id), userId: str(r.user_id), mode: r.mode as MatchResultRow['mode'], score: num(r.score), stage: num(r.stage), kills: num(r.kills),
  coins: num(r.coins), xp: num(r.xp), createdAt: num(r.created_at),
});
const toSolo = (r: Row): SoloSessionRow => ({
  id: str(r.id), userId: str(r.user_id), seed: num(r.seed), stage: num(r.stage), boosts: json<SoloSessionRow['boosts']>(r.boosts, []),
  difficulty: (str(r.difficulty) || 'normal') as SoloSessionRow['difficulty'],
  createdAt: num(r.created_at), consumedAt: nnum(r.consumed_at),
});
const toClaim = (r: Row): SoloClaimRow => ({ userId: str(r.user_id), day: num(r.day), coins: num(r.coins) });

export function createSqliteDb(ctor: SqliteCtor, path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const sql = new ctor(path);
  if (path !== ':memory:') sql.pragma('journal_mode = WAL');
  sql.pragma('foreign_keys = ON');
  migrate(sql);

  const stmt = (s: string) => sql.prepare(s);
  const one = <T>(s: string, map: (r: Row) => T) => {
    const st = stmt(s);
    return (...args: unknown[]): T | undefined => {
      const r = st.get(...args) as Row | undefined;
      return r ? map(r) : undefined;
    };
  };
  const many = <T>(s: string, map: (r: Row) => T) => {
    const st = stmt(s);
    return (...args: unknown[]): T[] => (st.all(...args) as Row[]).map(map);
  };
  const run = (s: string) => {
    const st = stmt(s);
    return (...args: unknown[]) => st.run(...args);
  };
  const countOf = (s: string) => {
    const st = stmt(s);
    return (...args: unknown[]) => (st.get(...args) as { n: number }).n;
  };

  const q = {
    userGet: one('SELECT * FROM users WHERE id = ?', toUser),
    userByHash: one('SELECT * FROM users WHERE device_hash = ?', toUser),
    userByNick: one('SELECT * FROM users WHERE nickname_lc = ?', toUser),
    userInsert: run('INSERT INTO users(id, device_hash, nickname, nickname_lc, skin, settings, created_at, last_seen, country) VALUES (?,?,?,?,?,?,?,?,?)'),
    userUpdate: run('UPDATE users SET device_hash=?, nickname=?, nickname_lc=?, skin=?, settings=?, created_at=?, last_seen=?, country=? WHERE id=?'),
    userCount: countOf('SELECT COUNT(*) AS n FROM users'),
    identityGet: one('SELECT * FROM identities WHERE provider = ? AND subject = ?', toIdentity),
    identityById: one('SELECT * FROM identities WHERE id = ?', toIdentity),
    identityForUser: many('SELECT * FROM identities WHERE user_id = ? ORDER BY created_at', toIdentity),
    identityInsert: run('INSERT INTO identities(id, user_id, provider, subject, email, email_verified, created_at, last_login_at) VALUES (?,?,?,?,?,?,?,?)'),
    identityUpdate: run('UPDATE identities SET user_id=?, provider=?, subject=?, email=?, email_verified=?, created_at=?, last_login_at=? WHERE id=?'),
    codeGet: one('SELECT * FROM email_codes WHERE email = ?', toEmailCode),
    codePut: run(
      'INSERT INTO email_codes(email, code_hash, user_id, expires_at, attempts, created_at) VALUES (?,?,?,?,?,?) ' +
        'ON CONFLICT(email) DO UPDATE SET code_hash=excluded.code_hash, user_id=excluded.user_id, expires_at=excluded.expires_at, ' +
        'attempts=excluded.attempts, created_at=excluded.created_at',
    ),
    codeRemove: run('DELETE FROM email_codes WHERE email = ?'),
    codeCountSince: countOf('SELECT COUNT(*) AS n FROM email_codes WHERE email = ? AND created_at >= ?'),
    friendList: many('SELECT * FROM friends WHERE user_id = ? ORDER BY created_at DESC', toFriend),
    friendHas: countOf('SELECT COUNT(*) AS n FROM friends WHERE user_id = ? AND friend_id = ?'),
    friendPut: run('INSERT INTO friends(user_id, friend_id, created_at) VALUES (?,?,?) ON CONFLICT(user_id, friend_id) DO NOTHING'),
    friendDel: run('DELETE FROM friends WHERE user_id = ? AND friend_id = ?'),
    friendCount: countOf('SELECT COUNT(*) AS n FROM friends WHERE user_id = ?'),
    freqGet: one('SELECT * FROM friend_requests WHERE id = ?', toFriendReq),
    freqPending: one("SELECT * FROM friend_requests WHERE from_id = ? AND to_id = ? AND status = 'pending'", toFriendReq),
    freqLast: one('SELECT * FROM friend_requests WHERE from_id = ? AND to_id = ? ORDER BY created_at DESC LIMIT 1', toFriendReq),
    freqIncoming: many("SELECT * FROM friend_requests WHERE to_id = ? AND status = 'pending' ORDER BY created_at DESC", toFriendReq),
    freqOutgoing: many("SELECT * FROM friend_requests WHERE from_id = ? AND status = 'pending' ORDER BY created_at DESC", toFriendReq),
    freqInsert: run('INSERT INTO friend_requests(id, from_id, to_id, status, created_at, responded_at) VALUES (?,?,?,?,?,?)'),
    freqUpdate: run('UPDATE friend_requests SET from_id=?, to_id=?, status=?, created_at=?, responded_at=? WHERE id=?'),
    freqCountFrom: countOf('SELECT COUNT(*) AS n FROM friend_requests WHERE from_id = ? AND created_at >= ?'),
    ratingGet: one('SELECT * FROM ratings WHERE user_id = ?', toRating),
    ratingPut: run(
      'INSERT INTO ratings(user_id, rating, wins, losses, draws, best, matches, updated_at) VALUES (?,?,?,?,?,?,?,?) ' +
        'ON CONFLICT(user_id) DO UPDATE SET rating=excluded.rating, wins=excluded.wins, losses=excluded.losses, draws=excluded.draws, ' +
        'best=excluded.best, matches=excluded.matches, updated_at=excluded.updated_at',
    ),
    ratingTop: many(
      'SELECT r.*, u.nickname, u.country FROM ratings r JOIN users u ON u.id = r.user_id ORDER BY r.rating DESC, r.updated_at ASC LIMIT ?',
      toRatingRanked,
    ),
    ratingTopCountry: many(
      'SELECT r.*, u.nickname, u.country FROM ratings r JOIN users u ON u.id = r.user_id WHERE u.country = ? ORDER BY r.rating DESC, r.updated_at ASC LIMIT ?',
      toRatingRanked,
    ),
    ratingAbove: countOf('SELECT COUNT(*) AS n FROM ratings WHERE rating > ?'),
    ratingAboveCountry: countOf('SELECT COUNT(*) AS n FROM ratings r JOIN users u ON u.id = r.user_id WHERE r.rating > ? AND u.country = ?'),
    ratingTotal: countOf('SELECT COUNT(*) AS n FROM ratings'),
    ratingTotalCountry: countOf('SELECT COUNT(*) AS n FROM ratings r JOIN users u ON u.id = r.user_id WHERE u.country = ?'),
    walletGet: one('SELECT * FROM wallets WHERE user_id = ?', toWallet),
    walletPut: run('INSERT INTO wallets(user_id, coins, gems) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET coins=excluded.coins, gems=excluded.gems'),
    ledgerInsert: run('INSERT INTO ledger(id, user_id, currency, amount, balance_after, reason, ref, created_at) VALUES (?,?,?,?,?,?,?,?)'),
    ledgerList: many('SELECT * FROM ledger WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?', toLedger),
    invGet: one('SELECT * FROM inventory WHERE user_id = ? AND sku = ?', toInv),
    invList: many('SELECT * FROM inventory WHERE user_id = ? ORDER BY sku', toInv),
    invPut: run('INSERT INTO inventory(user_id, sku, qty, equipped) VALUES (?,?,?,?) ON CONFLICT(user_id, sku) DO UPDATE SET qty=excluded.qty, equipped=excluded.equipped'),
    invRemove: run('DELETE FROM inventory WHERE user_id = ? AND sku = ?'),
    orderGet: one('SELECT * FROM orders WHERE id = ?', toOrder),
    orderInsert: run('INSERT INTO orders(id, user_id, sku, provider, status, amount_cents, currency, provider_ref, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)'),
    orderUpdate: run('UPDATE orders SET user_id=?, sku=?, provider=?, status=?, amount_cents=?, currency=?, provider_ref=?, created_at=?, updated_at=? WHERE id=?'),
    orderList: many('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC', toOrder),
    orderCompleted: countOf("SELECT COUNT(*) AS n FROM orders WHERE user_id = ? AND sku = ? AND status = 'completed'"),
    orderPending: countOf("SELECT COUNT(*) AS n FROM orders WHERE user_id = ? AND status = 'pending'"),
    giftGet: one('SELECT * FROM gifts WHERE id = ?', toGift),
    giftInsert: run('INSERT INTO gifts(id, from_id, to_id, sku, qty, message, status, created_at, claimed_at) VALUES (?,?,?,?,?,?,?,?,?)'),
    giftUpdate: run('UPDATE gifts SET from_id=?, to_id=?, sku=?, qty=?, message=?, status=?, created_at=?, claimed_at=? WHERE id=?'),
    giftInbox: many("SELECT * FROM gifts WHERE to_id = ? ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC", toGift),
    giftPending: countOf("SELECT COUNT(*) AS n FROM gifts WHERE to_id = ? AND status = 'pending'"),
    giftSent: countOf('SELECT COUNT(*) AS n FROM gifts WHERE from_id = ? AND created_at >= ?'),
    bpGet: one('SELECT * FROM battlepass WHERE user_id = ? AND season = ?', toBp),
    bpPut: run('INSERT INTO battlepass(user_id, season, xp, premium, claimed_free, claimed_premium) VALUES (?,?,?,?,?,?) ON CONFLICT(user_id, season) DO UPDATE SET xp=excluded.xp, premium=excluded.premium, claimed_free=excluded.claimed_free, claimed_premium=excluded.claimed_premium'),
    dailyGet: one('SELECT * FROM daily_rewards WHERE user_id = ?', toDaily),
    dailyPut: run('INSERT INTO daily_rewards(user_id, streak, last_claim_day, last_claim_at) VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET streak=excluded.streak, last_claim_day=excluded.last_claim_day, last_claim_at=excluded.last_claim_at'),
    adGet: one('SELECT * FROM ad_sessions WHERE id = ?', toAd),
    adInsert: run('INSERT INTO ad_sessions(id, user_id, placement, day, started_at, completed_at, match_result_id, coins) VALUES (?,?,?,?,?,?,?,?)'),
    adUpdate: run('UPDATE ad_sessions SET user_id=?, placement=?, day=?, started_at=?, completed_at=?, match_result_id=?, coins=? WHERE id=?'),
    adCount: countOf('SELECT COUNT(*) AS n FROM ad_sessions WHERE user_id = ? AND day = ?'),
    adForMatch: countOf('SELECT COUNT(*) AS n FROM ad_sessions WHERE user_id = ? AND match_result_id = ? AND completed_at IS NOT NULL'),
    matchInsert: run('INSERT INTO match_results(id, user_id, mode, score, stage, kills, coins, xp, created_at) VALUES (?,?,?,?,?,?,?,?,?)'),
    matchLatest: one('SELECT * FROM match_results WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1', toMatch),
    matchByUser: many('SELECT * FROM match_results WHERE user_id = ?', toMatch),
    matchByMode: many('SELECT * FROM match_results WHERE mode = ? ORDER BY score DESC, created_at ASC', toMatch),
    soloGet: one('SELECT * FROM solo_sessions WHERE id = ?', toSolo),
    soloInsert: run('INSERT INTO solo_sessions(id, user_id, seed, stage, boosts, difficulty, created_at, consumed_at) VALUES (?,?,?,?,?,?,?,?)'),
    soloUpdate: run('UPDATE solo_sessions SET user_id=?, seed=?, stage=?, boosts=?, difficulty=?, created_at=?, consumed_at=? WHERE id=?'),
    claimGet: one('SELECT * FROM solo_claims WHERE user_id = ? AND day = ?', toClaim),
    claimPut: run('INSERT INTO solo_claims(user_id, day, coins) VALUES (?,?,?) ON CONFLICT(user_id, day) DO UPDATE SET coins=excluded.coins'),
  };

  const need = <T>(v: T | undefined, what: string, id: string): T => {
    if (v === undefined) throw new Error(`${what} not found: ${id}`);
    return v;
  };

  const db: Db = {
    kind: 'sqlite',
    transaction: <T>(fn: () => T): T => sql.transaction(fn)(),
    close: () => sql.close(),
    users: {
      get: q.userGet,
      getByDeviceHash: q.userByHash,
      getByNickname: q.userByNick,
      getMany: (ids) => ids.map((id) => q.userGet(id)).filter((u): u is UserRow => !!u),
      insert: (u) => void q.userInsert(u.id, u.deviceHash, u.nickname, u.nicknameLc, u.skin, JSON.stringify(u.settings), u.createdAt, u.lastSeen, u.country ?? ''),
      update: (id, patch) => {
        const u = { ...need(q.userGet(id), 'user', id), ...patch };
        q.userUpdate(u.deviceHash, u.nickname, u.nicknameLc, u.skin, JSON.stringify(u.settings), u.createdAt, u.lastSeen, u.country ?? '', id);
        return u;
      },
      count: () => q.userCount(),
    },
    identities: {
      get: (provider, subject) => q.identityGet(provider, subject),
      listForUser: q.identityForUser,
      insert: (r) => void q.identityInsert(r.id, r.userId, r.provider, r.subject, r.email, r.emailVerified ? 1 : 0, r.createdAt, r.lastLoginAt),
      update: (id, patch) => {
        const r = { ...need(q.identityById(id), 'identity', id), ...patch };
        q.identityUpdate(r.userId, r.provider, r.subject, r.email, r.emailVerified ? 1 : 0, r.createdAt, r.lastLoginAt, id);
        return r;
      },
    },
    emailCodes: {
      get: q.codeGet,
      put: (r) => void q.codePut(r.email, r.codeHash, r.userId, r.expiresAt, r.attempts, r.createdAt),
      remove: (email) => void q.codeRemove(email),
      countSince: (email, since) => q.codeCountSince(email, since),
    },
    friends: {
      list: q.friendList,
      has: (a, b) => q.friendHas(a, b) > 0,
      link: (a, b, at) => {
        q.friendPut(a, b, at);
        q.friendPut(b, a, at);
      },
      unlink: (a, b) => {
        q.friendDel(a, b);
        q.friendDel(b, a);
      },
      count: (userId) => q.friendCount(userId),
    },
    friendRequests: {
      get: q.freqGet,
      pendingBetween: (from, to) => q.freqPending(from, to),
      lastBetween: (from, to) => q.freqLast(from, to),
      incoming: q.freqIncoming,
      outgoing: q.freqOutgoing,
      insert: (r) => void q.freqInsert(r.id, r.fromId, r.toId, r.status, r.createdAt, r.respondedAt),
      update: (id, patch) => {
        const r = { ...need(q.freqGet(id), 'friend request', id), ...patch };
        q.freqUpdate(r.fromId, r.toId, r.status, r.createdAt, r.respondedAt, id);
        return r;
      },
      countPendingFrom: (from, since) => q.freqCountFrom(from, since),
    },
    ratings: {
      get: q.ratingGet,
      put: (r) => void q.ratingPut(r.userId, r.rating, r.wins, r.losses, r.draws, r.best, r.matches, r.updatedAt),
      top: (limit, country) => (country ? q.ratingTopCountry(country, limit) : q.ratingTop(limit)),
      countAbove: (rating, country) => (country ? q.ratingAboveCountry(rating, country) : q.ratingAbove(rating)),
      countRated: (country) => (country ? q.ratingTotalCountry(country) : q.ratingTotal()),
    },
    wallets: { get: q.walletGet, put: (w) => void q.walletPut(w.userId, w.coins, w.gems) },
    ledger: {
      insert: (l) => void q.ledgerInsert(l.id, l.userId, l.currency, l.amount, l.balanceAfter, l.reason, l.ref, l.createdAt),
      list: (userId, limit = 100) => q.ledgerList(userId, limit),
    },
    inventory: {
      get: q.invGet,
      list: q.invList,
      put: (r) => void q.invPut(r.userId, r.sku, r.qty, r.equipped ? 1 : 0),
      remove: (userId, sku) => void q.invRemove(userId, sku),
    },
    orders: {
      get: q.orderGet,
      insert: (o) => void q.orderInsert(o.id, o.userId, o.sku, o.provider, o.status, o.amountCents, o.currency, o.providerRef, o.createdAt, o.updatedAt),
      update: (id, patch) => {
        const o = { ...need(q.orderGet(id), 'order', id), ...patch };
        q.orderUpdate(o.userId, o.sku, o.provider, o.status, o.amountCents, o.currency, o.providerRef, o.createdAt, o.updatedAt, id);
        return o;
      },
      list: q.orderList,
      hasCompleted: (userId, sku) => q.orderCompleted(userId, sku) > 0,
      countPending: (userId) => q.orderPending(userId),
    },
    gifts: {
      get: q.giftGet,
      insert: (g) => void q.giftInsert(g.id, g.fromId, g.toId, g.sku, g.qty, g.message, g.status, g.createdAt, g.claimedAt),
      update: (id, patch) => {
        const g = { ...need(q.giftGet(id), 'gift', id), ...patch };
        q.giftUpdate(g.fromId, g.toId, g.sku, g.qty, g.message, g.status, g.createdAt, g.claimedAt, id);
        return g;
      },
      listForRecipient: q.giftInbox,
      countPending: (toId) => q.giftPending(toId),
      countSentSince: (fromId, since) => q.giftSent(fromId, since),
    },
    battlepass: {
      get: q.bpGet,
      put: (b) => void q.bpPut(b.userId, b.season, b.xp, b.premium ? 1 : 0, JSON.stringify(b.claimedFree), JSON.stringify(b.claimedPremium)),
    },
    daily: { get: q.dailyGet, put: (d) => void q.dailyPut(d.userId, d.streak, d.lastClaimDay, d.lastClaimAt) },
    ads: {
      get: q.adGet,
      insert: (a) => void q.adInsert(a.id, a.userId, a.placement, a.day, a.startedAt, a.completedAt, a.matchResultId, a.coins),
      update: (id, patch) => {
        const a = { ...need(q.adGet(id), 'ad session', id), ...patch };
        q.adUpdate(a.userId, a.placement, a.day, a.startedAt, a.completedAt, a.matchResultId, a.coins, id);
        return a;
      },
      countForDay: (userId, day) => q.adCount(userId, day),
      hasCompletedForMatch: (userId, matchId) => q.adForMatch(userId, matchId) > 0,
    },
    matches: {
      insert: (m) => void q.matchInsert(m.id, m.userId, m.mode, m.score, m.stage, m.kills, m.coins, m.xp, m.createdAt),
      latest: q.matchLatest,
      stats: (userId) => statsOf(q.matchByUser(userId)),
      bestPerUser: (mode) => bestPerUserOf(q.matchByMode(mode)),
    },
    solo: {
      get: q.soloGet,
      insert: (s) => void q.soloInsert(s.id, s.userId, s.seed, s.stage, JSON.stringify(s.boosts), s.difficulty, s.createdAt, s.consumedAt),
      update: (id, patch) => {
        const s = { ...need(q.soloGet(id), 'solo session', id), ...patch };
        q.soloUpdate(s.userId, s.seed, s.stage, JSON.stringify(s.boosts), s.difficulty, s.createdAt, s.consumedAt, id);
        return s;
      },
    },
    soloClaims: { get: q.claimGet, put: (c) => void q.claimPut(c.userId, c.day, c.coins) },
  };
  return db;
}
