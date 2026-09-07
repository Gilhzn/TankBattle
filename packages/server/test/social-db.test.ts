import { describe, expect, it } from 'vitest';
import { loadSqlite } from '../src/db/index.js';
import { createJsonDb } from '../src/db/json.js';
import type { Db, UserRow } from '../src/db/repo.js';
import { createSqliteDb } from '../src/db/sqlite.js';

const sqlite = loadSqlite();
const stores: Array<[string, () => Db]> = [['json', () => createJsonDb(null)]];
if (sqlite) stores.push(['sqlite', () => createSqliteDb(sqlite, ':memory:')]);

const user = (id: string, nick: string, country = 'IL'): UserRow => ({
  id, deviceHash: `h-${id}`, nickname: nick, nicknameLc: nick.toLowerCase(), skin: 'default',
  settings: {}, createdAt: 1, lastSeen: 1, country,
});

/** Both stores must behave identically — the JSON one is the fallback when sqlite will not load. */
describe.each(stores)('social repositories (%s)', (_name, open) => {
  function setup(): Db {
    const db = open();
    db.users.insert(user('u1', 'Alice'));
    db.users.insert(user('u2', 'Bob'));
    db.users.insert(user('u3', 'Carol', 'US'));
    return db;
  }

  it('fetches users in bulk, skipping ids that are gone', () => {
    const db = setup();
    expect(db.users.getMany(['u1', 'nope', 'u3']).map((u) => u.id).sort()).toEqual(['u1', 'u3']);
  });

  describe('identities', () => {
    const identity = (id: string, userId: string, provider: 'google' | 'email', subject: string) => ({
      id, userId, provider, subject, email: `${subject}@example.com`, emailVerified: true, createdAt: 10, lastLoginAt: 10,
    });

    it('looks an identity up by provider and subject', () => {
      const db = setup();
      db.identities.insert(identity('i1', 'u1', 'google', 'sub-1'));
      expect(db.identities.get('google', 'sub-1')?.userId).toBe('u1');
      expect(db.identities.get('email', 'sub-1')).toBeUndefined();
      expect(db.identities.get('google', 'other')).toBeUndefined();
    });

    it('refuses to register the same identity twice', () => {
      const db = setup();
      db.identities.insert(identity('i1', 'u1', 'google', 'sub-1'));
      expect(() => db.identities.insert(identity('i2', 'u2', 'google', 'sub-1'))).toThrow();
    });

    it('lists every way into one account', () => {
      const db = setup();
      db.identities.insert(identity('i1', 'u1', 'google', 'sub-1'));
      db.identities.insert(identity('i2', 'u1', 'email', 'alice'));
      expect(db.identities.listForUser('u1').map((i) => i.provider).sort()).toEqual(['email', 'google']);
    });
  });

  describe('email codes', () => {
    it('keeps one live challenge per address and replaces it on resend', () => {
      const db = setup();
      db.emailCodes.put({ email: 'a@b.com', codeHash: 'h1', userId: null, expiresAt: 100, attempts: 0, createdAt: 10 });
      db.emailCodes.put({ email: 'a@b.com', codeHash: 'h2', userId: 'u1', expiresAt: 200, attempts: 0, createdAt: 20 });
      expect(db.emailCodes.get('a@b.com')).toMatchObject({ codeHash: 'h2', userId: 'u1', expiresAt: 200 });
    });

    it('reports a recent challenge for the rate limiter, and forgets a removed one', () => {
      const db = setup();
      db.emailCodes.put({ email: 'a@b.com', codeHash: 'h', userId: null, expiresAt: 100, attempts: 0, createdAt: 50 });
      expect(db.emailCodes.countSince('a@b.com', 40)).toBe(1);
      expect(db.emailCodes.countSince('a@b.com', 60)).toBe(0);
      db.emailCodes.remove('a@b.com');
      expect(db.emailCodes.get('a@b.com')).toBeUndefined();
    });
  });

  describe('friends', () => {
    it('links both directions at once', () => {
      const db = setup();
      db.friends.link('u1', 'u2', 100);
      expect(db.friends.has('u1', 'u2')).toBe(true);
      expect(db.friends.has('u2', 'u1')).toBe(true);
      expect(db.friends.list('u1').map((f) => f.friendId)).toEqual(['u2']);
      expect(db.friends.count('u2')).toBe(1);
    });

    it('is idempotent, so accepting twice cannot duplicate a friendship', () => {
      const db = setup();
      db.friends.link('u1', 'u2', 100);
      db.friends.link('u1', 'u2', 200);
      expect(db.friends.count('u1')).toBe(1);
    });

    it('unlinks both directions', () => {
      const db = setup();
      db.friends.link('u1', 'u2', 100);
      db.friends.unlink('u2', 'u1');
      expect(db.friends.has('u1', 'u2')).toBe(false);
      expect(db.friends.has('u2', 'u1')).toBe(false);
    });

    it('lists newest friendships first', () => {
      const db = setup();
      db.friends.link('u1', 'u2', 100);
      db.friends.link('u1', 'u3', 200);
      expect(db.friends.list('u1').map((f) => f.friendId)).toEqual(['u3', 'u2']);
    });
  });

  describe('friend requests', () => {
    const req = (id: string, from: string, to: string, createdAt = 100) => ({
      id, fromId: from, toId: to, status: 'pending' as const, createdAt, respondedAt: null,
    });

    it('finds the live request in one direction only', () => {
      const db = setup();
      db.friendRequests.insert(req('r1', 'u1', 'u2'));
      expect(db.friendRequests.pendingBetween('u1', 'u2')?.id).toBe('r1');
      expect(db.friendRequests.pendingBetween('u2', 'u1')).toBeUndefined();
    });

    it('stops matching once the request is answered', () => {
      const db = setup();
      db.friendRequests.insert(req('r1', 'u1', 'u2'));
      db.friendRequests.update('r1', { status: 'declined', respondedAt: 150 });
      expect(db.friendRequests.pendingBetween('u1', 'u2')).toBeUndefined();
      // ...but the decline is still findable, which is what the cooldown reads.
      expect(db.friendRequests.lastBetween('u1', 'u2')).toMatchObject({ status: 'declined', respondedAt: 150 });
    });

    it('returns the most recent request for the cooldown check', () => {
      const db = setup();
      db.friendRequests.insert(req('r1', 'u1', 'u2', 100));
      db.friendRequests.update('r1', { status: 'declined', respondedAt: 110 });
      db.friendRequests.insert(req('r2', 'u1', 'u2', 300));
      expect(db.friendRequests.lastBetween('u1', 'u2')?.id).toBe('r2');
    });

    it('splits incoming from outgoing', () => {
      const db = setup();
      db.friendRequests.insert(req('r1', 'u1', 'u2'));
      db.friendRequests.insert(req('r2', 'u3', 'u2'));
      expect(db.friendRequests.incoming('u2').map((r) => r.id).sort()).toEqual(['r1', 'r2']);
      expect(db.friendRequests.outgoing('u1').map((r) => r.id)).toEqual(['r1']);
    });

    it('counts recent requests from one sender for the rate limiter', () => {
      const db = setup();
      db.friendRequests.insert(req('r1', 'u1', 'u2', 100));
      db.friendRequests.insert(req('r2', 'u1', 'u3', 300));
      expect(db.friendRequests.countPendingFrom('u1', 0)).toBe(2);
      expect(db.friendRequests.countPendingFrom('u1', 200)).toBe(1);
    });
  });

  describe('ratings', () => {
    const rating = (userId: string, r: number) => ({
      userId, rating: r, wins: 1, losses: 0, draws: 0, best: r, matches: 1, updatedAt: 1,
    });

    it('ranks players best first and joins their nickname', () => {
      const db = setup();
      db.ratings.put(rating('u1', 1200));
      db.ratings.put(rating('u2', 1400));
      db.ratings.put(rating('u3', 1000));
      expect(db.ratings.top(10).map((r) => r.nickname)).toEqual(['Bob', 'Alice', 'Carol']);
    });

    it('filters the board to one country', () => {
      const db = setup();
      db.ratings.put(rating('u1', 1200));
      db.ratings.put(rating('u2', 1400));
      db.ratings.put(rating('u3', 1600)); // Carol is US
      expect(db.ratings.top(10, 'IL').map((r) => r.nickname)).toEqual(['Bob', 'Alice']);
      expect(db.ratings.countRated('IL')).toBe(2);
      expect(db.ratings.countRated()).toBe(3);
    });

    it('counts who is above a rating, globally and at home', () => {
      const db = setup();
      db.ratings.put(rating('u1', 1200));
      db.ratings.put(rating('u2', 1400));
      db.ratings.put(rating('u3', 1600));
      expect(db.ratings.countAbove(1200)).toBe(2);
      expect(db.ratings.countAbove(1200, 'IL')).toBe(1);
      expect(db.ratings.countAbove(1600)).toBe(0);
    });

    it('overwrites a player row rather than adding a second one', () => {
      const db = setup();
      db.ratings.put(rating('u1', 1200));
      db.ratings.put(rating('u1', 1250));
      expect(db.ratings.countRated()).toBe(1);
      expect(db.ratings.get('u1')?.rating).toBe(1250);
    });
  });
});
