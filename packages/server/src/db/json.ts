import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  bestPerUserOf, sortGifts, statsOf,
  type AdSessionRow, type BattlepassRow, type DailyRow, type Db, type GiftRow, type InventoryRow, type LedgerRow, type MatchResultRow,
  type OrderRow, type SoloClaimRow, type SoloSessionRow, type UserRow, type WalletRow,
  type EmailCodeRow, type FriendRequestRow, type FriendRow, type IdentityRow, type RatingRow,
} from './repo.js';

/** In-memory tables. Persisted as JSON (debounced, atomic) when a file path is given. */
interface Data {
  users: Map<string, UserRow>;
  wallets: Map<string, WalletRow>;
  ledger: LedgerRow[];
  inventory: Map<string, InventoryRow>; // `${userId}:${sku}`
  orders: Map<string, OrderRow>;
  gifts: Map<string, GiftRow>;
  battlepass: Map<string, BattlepassRow>; // `${userId}:${season}`
  daily: Map<string, DailyRow>;
  ads: Map<string, AdSessionRow>;
  matches: MatchResultRow[];
  solo: Map<string, SoloSessionRow>;
  soloClaims: Map<string, SoloClaimRow>; // `${userId}:${day}`
  identities: Map<string, IdentityRow>; // by identity id
  emailCodes: Map<string, EmailCodeRow>; // by lower-cased email
  friends: Map<string, FriendRow>; // `${userId}:${friendId}`, one row per direction
  friendRequests: Map<string, FriendRequestRow>;
  ratings: Map<string, RatingRow>; // by userId
}

const emptyData = (): Data => ({
  users: new Map(), wallets: new Map(), ledger: [], inventory: new Map(), orders: new Map(), gifts: new Map(),
  battlepass: new Map(), daily: new Map(), ads: new Map(), matches: [], solo: new Map(), soloClaims: new Map(),
  identities: new Map(), emailCodes: new Map(), friends: new Map(), friendRequests: new Map(), ratings: new Map(),
});

type Serialized = { [K in keyof Data]: Data[K] extends Map<string, infer V> ? [string, V][] : Data[K] };

function serialize(d: Data): string {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d)) out[k] = v instanceof Map ? [...v.entries()] : v;
  return JSON.stringify({ version: 1, data: out });
}

function deserialize(text: string): Data {
  const d = emptyData();
  const parsed = JSON.parse(text) as { data?: Partial<Serialized> };
  const src = parsed.data ?? {};
  for (const key of Object.keys(d) as (keyof Data)[]) {
    const v = src[key];
    if (!v) continue;
    const target = d[key];
    if (target instanceof Map) for (const [k, row] of v as [string, never][]) target.set(k, row);
    else (d[key] as unknown[]).push(...(v as unknown[]));
  }
  return d;
}

function patchRow<T extends { id: string }>(map: Map<string, T>, id: string, patch: Partial<Omit<T, 'id'>>, what: string): T {
  const cur = map.get(id);
  if (!cur) throw new Error(`${what} not found: ${id}`);
  const next: T = { ...cur, ...patch, id };
  map.set(id, next);
  return next;
}

export function createJsonDb(filePath: string | null): Db {
  let data = emptyData();
  if (filePath) {
    try {
      data = deserialize(readFileSync(filePath, 'utf8'));
    } catch {
      /* fresh store */
    }
  }
  let saveTimer: NodeJS.Timeout | null = null;
  let dirty = false;
  const flush = () => {
    if (!filePath || !dirty) return;
    dirty = false;
    mkdirSync(dirname(filePath), { recursive: true });
    const tmp = `${filePath}.${process.pid}.tmp`;
    writeFileSync(tmp, serialize(data));
    renameSync(tmp, filePath);
  };
  const touch = () => {
    dirty = true;
    if (!filePath || saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      try {
        flush();
      } catch (err) {
        console.warn('[json-db] save failed', err);
      }
    }, 500);
    saveTimer.unref();
  };

  let depth = 0;
  const db: Db = {
    kind: 'json',
    transaction<T>(fn: () => T): T {
      if (depth > 0) return fn();
      const snapshot = structuredClone(data);
      depth++;
      try {
        return fn();
      } catch (err) {
        data = snapshot;
        throw err;
      } finally {
        depth--;
      }
    },
    close() {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = null;
      flush();
    },
    users: {
      get: (id) => data.users.get(id),
      getByDeviceHash: (h) => [...data.users.values()].find((u) => u.deviceHash === h),
      getByNickname: (lc) => [...data.users.values()].find((u) => u.nicknameLc === lc),
      getMany: (ids) => ids.map((id) => data.users.get(id)).filter((u): u is UserRow => !!u),
      insert: (row) => {
        if (data.users.has(row.id)) throw new Error('duplicate user id');
        if ([...data.users.values()].some((u) => u.nicknameLc === row.nicknameLc)) throw new Error('duplicate nickname');
        data.users.set(row.id, { ...row });
        touch();
      },
      update: (id, patch) => {
        if (patch.nicknameLc && [...data.users.values()].some((u) => u.id !== id && u.nicknameLc === patch.nicknameLc)) throw new Error('duplicate nickname');
        const r = patchRow(data.users, id, patch, 'user');
        touch();
        return r;
      },
      count: () => data.users.size,
    },
    identities: {
      get: (provider, subject) => [...data.identities.values()].find((i) => i.provider === provider && i.subject === subject),
      listForUser: (userId) => [...data.identities.values()].filter((i) => i.userId === userId).sort((a, b) => a.createdAt - b.createdAt),
      insert: (row) => {
        if ([...data.identities.values()].some((i) => i.provider === row.provider && i.subject === row.subject)) {
          throw new Error('duplicate identity');
        }
        data.identities.set(row.id, { ...row });
        touch();
      },
      update: (id, patch) => {
        const r = patchRow(data.identities, id, patch, 'identity');
        touch();
        return r;
      },
    },
    emailCodes: {
      get: (email) => data.emailCodes.get(email),
      put: (row) => {
        data.emailCodes.set(row.email, { ...row });
        touch();
      },
      remove: (email) => {
        data.emailCodes.delete(email);
        touch();
      },
      // Only the live challenge per address is kept, so "how many since" is 0 or 1. That is enough
      // for the rate limiter, which only needs to know whether one was issued recently.
      countSince: (email, since) => {
        const row = data.emailCodes.get(email);
        return row && row.createdAt >= since ? 1 : 0;
      },
    },
    friends: {
      list: (userId) => [...data.friends.values()].filter((f) => f.userId === userId).sort((a, b) => b.createdAt - a.createdAt),
      has: (a, b) => data.friends.has(`${a}:${b}`),
      link: (a, b, at) => {
        data.friends.set(`${a}:${b}`, { userId: a, friendId: b, createdAt: at });
        data.friends.set(`${b}:${a}`, { userId: b, friendId: a, createdAt: at });
        touch();
      },
      unlink: (a, b) => {
        data.friends.delete(`${a}:${b}`);
        data.friends.delete(`${b}:${a}`);
        touch();
      },
      count: (userId) => [...data.friends.values()].filter((f) => f.userId === userId).length,
    },
    friendRequests: {
      get: (id) => data.friendRequests.get(id),
      pendingBetween: (from, to) => [...data.friendRequests.values()].find((r) => r.fromId === from && r.toId === to && r.status === 'pending'),
      lastBetween: (from, to) =>
        [...data.friendRequests.values()].filter((r) => r.fromId === from && r.toId === to).sort((a, b) => b.createdAt - a.createdAt)[0],
      incoming: (to) => [...data.friendRequests.values()].filter((r) => r.toId === to && r.status === 'pending').sort((a, b) => b.createdAt - a.createdAt),
      outgoing: (from) => [...data.friendRequests.values()].filter((r) => r.fromId === from && r.status === 'pending').sort((a, b) => b.createdAt - a.createdAt),
      insert: (row) => {
        if (data.friendRequests.has(row.id)) throw new Error('duplicate friend request id');
        data.friendRequests.set(row.id, { ...row });
        touch();
      },
      update: (id, patch) => {
        const r = patchRow(data.friendRequests, id, patch, 'friend request');
        touch();
        return r;
      },
      countPendingFrom: (from, since) => [...data.friendRequests.values()].filter((r) => r.fromId === from && r.createdAt >= since).length,
    },
    ratings: {
      get: (userId) => data.ratings.get(userId),
      put: (row) => {
        data.ratings.set(row.userId, { ...row });
        touch();
      },
      top: (limit, country) =>
        [...data.ratings.values()]
          .map((r) => ({ ...r, user: data.users.get(r.userId) }))
          .filter((r) => !!r.user && (!country || r.user.country === country))
          .sort((a, b) => b.rating - a.rating || a.updatedAt - b.updatedAt)
          .slice(0, limit)
          .map(({ user, ...r }) => ({ ...r, nickname: user!.nickname, country: user!.country })),
      countAbove: (rating, country) =>
        [...data.ratings.values()].filter((r) => r.rating > rating && (!country || data.users.get(r.userId)?.country === country)).length,
      countRated: (country) => [...data.ratings.values()].filter((r) => !country || data.users.get(r.userId)?.country === country).length,
    },
    wallets: {
      get: (userId) => data.wallets.get(userId),
      put: (row) => {
        data.wallets.set(row.userId, { ...row });
        touch();
      },
    },
    ledger: {
      insert: (row) => {
        data.ledger.push({ ...row });
        touch();
      },
      list: (userId, limit = 100) => data.ledger.filter((l) => l.userId === userId).slice(-limit).reverse(),
    },
    inventory: {
      get: (userId, sku) => data.inventory.get(`${userId}:${sku}`),
      list: (userId) => [...data.inventory.values()].filter((r) => r.userId === userId),
      put: (row) => {
        data.inventory.set(`${row.userId}:${row.sku}`, { ...row });
        touch();
      },
      remove: (userId, sku) => {
        data.inventory.delete(`${userId}:${sku}`);
        touch();
      },
    },
    orders: {
      get: (id) => data.orders.get(id),
      insert: (row) => {
        data.orders.set(row.id, { ...row });
        touch();
      },
      update: (id, patch) => {
        const r = patchRow(data.orders, id, patch, 'order');
        touch();
        return r;
      },
      list: (userId) => [...data.orders.values()].filter((o) => o.userId === userId).sort((a, b) => b.createdAt - a.createdAt),
      hasCompleted: (userId, sku) => [...data.orders.values()].some((o) => o.userId === userId && o.sku === sku && o.status === 'completed'),
      countPending: (userId) => [...data.orders.values()].filter((o) => o.userId === userId && o.status === 'pending').length,
    },
    gifts: {
      get: (id) => data.gifts.get(id),
      insert: (row) => {
        data.gifts.set(row.id, { ...row });
        touch();
      },
      update: (id, patch) => {
        const r = patchRow(data.gifts, id, patch, 'gift');
        touch();
        return r;
      },
      listForRecipient: (toId) => sortGifts([...data.gifts.values()].filter((g) => g.toId === toId)),
      countPending: (toId) => [...data.gifts.values()].filter((g) => g.toId === toId && g.status === 'pending').length,
      countSentSince: (fromId, since) => [...data.gifts.values()].filter((g) => g.fromId === fromId && g.createdAt >= since).length,
    },
    battlepass: {
      get: (userId, season) => data.battlepass.get(`${userId}:${season}`),
      put: (row) => {
        data.battlepass.set(`${row.userId}:${row.season}`, { ...row, claimedFree: [...row.claimedFree], claimedPremium: [...row.claimedPremium] });
        touch();
      },
    },
    daily: {
      get: (userId) => data.daily.get(userId),
      put: (row) => {
        data.daily.set(row.userId, { ...row });
        touch();
      },
    },
    ads: {
      get: (id) => data.ads.get(id),
      insert: (row) => {
        data.ads.set(row.id, { ...row });
        touch();
      },
      update: (id, patch) => {
        const r = patchRow(data.ads, id, patch, 'ad session');
        touch();
        return r;
      },
      countForDay: (userId, day) => [...data.ads.values()].filter((a) => a.userId === userId && a.day === day).length,
      hasCompletedForMatch: (userId, matchResultId) =>
        [...data.ads.values()].some((a) => a.userId === userId && a.matchResultId === matchResultId && a.completedAt !== null),
    },
    matches: {
      insert: (row) => {
        data.matches.push({ ...row });
        touch();
      },
      latest: (userId) => {
        for (let i = data.matches.length - 1; i >= 0; i--) if (data.matches[i].userId === userId) return data.matches[i];
        return undefined;
      },
      stats: (userId) => statsOf(data.matches.filter((m) => m.userId === userId)),
      bestPerUser: (mode) => bestPerUserOf(data.matches.filter((m) => m.mode === mode)),
    },
    solo: {
      get: (id) => data.solo.get(id),
      insert: (row) => {
        data.solo.set(row.id, { ...row, boosts: [...row.boosts] });
        touch();
      },
      update: (id, patch) => {
        const r = patchRow(data.solo, id, patch, 'solo session');
        touch();
        return r;
      },
    },
    soloClaims: {
      get: (userId, day) => data.soloClaims.get(`${userId}:${day}`),
      put: (row) => {
        data.soloClaims.set(`${row.userId}:${row.day}`, { ...row });
        touch();
      },
    },
  };
  return db;
}
