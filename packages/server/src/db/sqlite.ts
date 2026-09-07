import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type BetterSqlite3 from 'better-sqlite3';
import {
  bestPerUserOf, statsOf,
  type AdSessionRow, type BattlepassRow, type DailyRow, type Db, type GiftRow, type InventoryRow, type LedgerRow, type MatchResultRow,
  type OrderRow, type SoloClaimRow, type SoloSessionRow, type UserRow, type WalletRow,
} from './repo.js';

type SqliteCtor = typeof BetterSqlite3;
type Row = Record<string, unknown>;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, device_hash TEXT NOT NULL UNIQUE, nickname TEXT NOT NULL, nickname_lc TEXT NOT NULL UNIQUE,
  skin TEXT NOT NULL DEFAULT 'default', settings TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL);
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
  created_at INTEGER NOT NULL, consumed_at INTEGER);
CREATE TABLE IF NOT EXISTS solo_claims (user_id TEXT NOT NULL, day INTEGER NOT NULL, coins INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(user_id, day));
CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);
`;

const SCHEMA_VERSION = 1;

/** Applies idempotent migrations. New versions append statements guarded by the stored version. */
function migrate(db: BetterSqlite3.Database): void {
  db.exec(SCHEMA);
  const row = db.prepare('SELECT version FROM schema_version LIMIT 1').get() as { version: number } | undefined;
  if (!row) db.prepare('INSERT INTO schema_version(version) VALUES (?)').run(SCHEMA_VERSION);
  else if (row.version < SCHEMA_VERSION) db.prepare('UPDATE schema_version SET version = ?').run(SCHEMA_VERSION);
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
    userInsert: run('INSERT INTO users(id, device_hash, nickname, nickname_lc, skin, settings, created_at, last_seen) VALUES (?,?,?,?,?,?,?,?)'),
    userUpdate: run('UPDATE users SET device_hash=?, nickname=?, nickname_lc=?, skin=?, settings=?, created_at=?, last_seen=? WHERE id=?'),
    userCount: countOf('SELECT COUNT(*) AS n FROM users'),
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
    soloInsert: run('INSERT INTO solo_sessions(id, user_id, seed, stage, boosts, created_at, consumed_at) VALUES (?,?,?,?,?,?,?)'),
    soloUpdate: run('UPDATE solo_sessions SET user_id=?, seed=?, stage=?, boosts=?, created_at=?, consumed_at=? WHERE id=?'),
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
      insert: (u) => void q.userInsert(u.id, u.deviceHash, u.nickname, u.nicknameLc, u.skin, JSON.stringify(u.settings), u.createdAt, u.lastSeen),
      update: (id, patch) => {
        const u = { ...need(q.userGet(id), 'user', id), ...patch };
        q.userUpdate(u.deviceHash, u.nickname, u.nicknameLc, u.skin, JSON.stringify(u.settings), u.createdAt, u.lastSeen, id);
        return u;
      },
      count: () => q.userCount(),
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
      insert: (s) => void q.soloInsert(s.id, s.userId, s.seed, s.stage, JSON.stringify(s.boosts), s.createdAt, s.consumedAt),
      update: (id, patch) => {
        const s = { ...need(q.soloGet(id), 'solo session', id), ...patch };
        q.soloUpdate(s.userId, s.seed, s.stage, JSON.stringify(s.boosts), s.createdAt, s.consumedAt, id);
        return s;
      },
    },
    soloClaims: { get: q.claimGet, put: (c) => void q.claimPut(c.userId, c.day, c.coins) },
  };
  return db;
}
