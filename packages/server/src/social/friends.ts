import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Db, FriendRequestRow, UserRow } from '../db/repo.js';
import { badRequest, conflict, notFound, tooMany } from '../util/errors.js';
import { newId } from '../util/ids.js';
import type { Clock } from '../util/time.js';
import type { Presence, PresenceState } from './presence.js';

/** A player cannot hold more friends than this. */
export const MAX_FRIENDS = 200;
/** Requests one player may send per day, so the nickname search cannot be used to spam strangers. */
export const MAX_REQUESTS_PER_DAY = 50;
/** After a decline, the same person cannot ask again for this long. */
export const DECLINE_COOLDOWN_MS = 24 * 3600_000;
/** How long a WhatsApp invite link stays valid. */
export const INVITE_TTL_MS = 7 * 24 * 3600_000;

export interface FriendView {
  id: string;
  nickname: string;
  skin: string;
  country: string;
  state: PresenceState;
  lastSeen: number;
  rating: number;
  since: number;
}

export interface RequestView {
  id: string;
  user: { id: string; nickname: string; skin: string; country: string; rating: number };
  createdAt: number;
}

export interface FriendsDeps {
  db: Db;
  clock: Clock;
  presence: Presence;
  /** Signing key for invite codes. */
  secret: string;
  publicUrl: string | null;
}

export class FriendsService {
  constructor(private readonly deps: FriendsDeps) {}

  private ratingOf(userId: string): number {
    return this.deps.db.ratings.get(userId)?.rating ?? 0;
  }

  private view(u: UserRow, since: number): FriendView {
    const p = this.deps.presence.of(u.id, u.lastSeen);
    return { id: u.id, nickname: u.nickname, skin: u.skin, country: u.country, state: p.state, lastSeen: p.lastSeen, rating: this.ratingOf(u.id), since };
  }

  /** The player's friends: online first, then most recently seen. */
  list(userId: string): FriendView[] {
    const rows = this.deps.db.friends.list(userId);
    const users = new Map(this.deps.db.users.getMany(rows.map((r) => r.friendId)).map((u) => [u.id, u]));
    const order: Record<PresenceState, number> = { in_match: 0, online: 1, offline: 2 };
    return rows
      .map((r) => {
        const u = users.get(r.friendId);
        return u ? this.view(u, r.createdAt) : null;
      })
      .filter((f): f is FriendView => !!f)
      .sort((a, b) => order[a.state] - order[b.state] || b.lastSeen - a.lastSeen || a.nickname.localeCompare(b.nickname));
  }

  private requestView(r: FriendRequestRow, otherId: string): RequestView | null {
    const u = this.deps.db.users.get(otherId);
    if (!u) return null;
    return {
      id: r.id,
      user: { id: u.id, nickname: u.nickname, skin: u.skin, country: u.country, rating: this.ratingOf(u.id) },
      createdAt: r.createdAt,
    };
  }

  incoming(userId: string): RequestView[] {
    return this.deps.db.friendRequests.incoming(userId).map((r) => this.requestView(r, r.fromId)).filter((v): v is RequestView => !!v);
  }

  outgoing(userId: string): RequestView[] {
    return this.deps.db.friendRequests.outgoing(userId).map((r) => this.requestView(r, r.toId)).filter((v): v is RequestView => !!v);
  }

  /** Finds the account a friend request is addressed to. Nicknames are unique, so this is exact. */
  private resolveNickname(nickname: string): UserRow {
    const u = this.deps.db.users.getByNickname(nickname.trim().toLowerCase());
    if (!u) throw notFound('no player with that nickname', 'player_not_found');
    return u;
  }

  /**
   * Sends a friend request by nickname.
   *
   * If the other player has already asked *you*, this accepts their request instead of opening a
   * second one in the opposite direction — two people reaching for each other at the same time
   * should end up friends, not with a pair of pending requests neither can resolve.
   */
  request(fromId: string, nickname: string): { status: 'sent' | 'accepted'; request?: RequestView; friend?: FriendView } {
    const to = this.resolveNickname(nickname);
    const now = this.deps.clock();
    if (to.id === fromId) throw badRequest('you cannot add yourself', 'self_request');
    if (this.deps.db.friends.has(fromId, to.id)) throw conflict('you are already friends', 'already_friends');
    if (this.deps.db.friends.count(fromId) >= MAX_FRIENDS) throw conflict('your friends list is full', 'friends_full');
    if (this.deps.db.friends.count(to.id) >= MAX_FRIENDS) throw conflict('their friends list is full', 'their_friends_full');

    return this.deps.db.transaction(() => {
      const mirror = this.deps.db.friendRequests.pendingBetween(to.id, fromId);
      if (mirror) {
        const friend = this.accept(fromId, mirror.id);
        return { status: 'accepted' as const, friend };
      }
      if (this.deps.db.friendRequests.pendingBetween(fromId, to.id)) throw conflict('you already asked them', 'already_requested');
      if (this.deps.db.friendRequests.countPendingFrom(fromId, now - 24 * 3600_000) >= MAX_REQUESTS_PER_DAY) {
        throw tooMany('you have sent a lot of requests today — try again tomorrow', 'too_many_requests');
      }
      // A declined request is a "no". Honour it for a day rather than letting someone re-send on a
      // loop until the other player gives in.
      const previous = this.deps.db.friendRequests.lastBetween(fromId, to.id);
      if (previous?.status === 'declined' && now - (previous.respondedAt ?? previous.createdAt) < DECLINE_COOLDOWN_MS) {
        throw tooMany('they declined recently — you can ask again tomorrow', 'recently_declined');
      }
      const row: FriendRequestRow = { id: newId(), fromId, toId: to.id, status: 'pending', createdAt: now, respondedAt: null };
      this.deps.db.friendRequests.insert(row);
      return { status: 'sent' as const, request: this.requestView(row, to.id) ?? undefined };
    });
  }

  /** Accepts an incoming request. Only its recipient may. */
  accept(userId: string, requestId: string): FriendView {
    return this.deps.db.transaction(() => {
      const r = this.deps.db.friendRequests.get(requestId);
      if (!r || r.toId !== userId) throw notFound('no such request', 'request_not_found');
      if (r.status !== 'pending') throw conflict('that request was already answered', 'request_closed');
      const now = this.deps.clock();
      this.deps.db.friendRequests.update(r.id, { status: 'accepted', respondedAt: now });
      this.deps.db.friends.link(r.fromId, r.toId, now);
      const other = this.deps.db.users.get(r.fromId);
      if (!other) throw notFound('that player no longer exists', 'player_not_found');
      return this.view(other, now);
    });
  }

  /** Declines an incoming request. */
  decline(userId: string, requestId: string): void {
    const r = this.deps.db.friendRequests.get(requestId);
    if (!r || r.toId !== userId) throw notFound('no such request', 'request_not_found');
    if (r.status !== 'pending') throw conflict('that request was already answered', 'request_closed');
    this.deps.db.friendRequests.update(r.id, { status: 'declined', respondedAt: this.deps.clock() });
  }

  /** Withdraws a request you sent. */
  cancel(userId: string, requestId: string): void {
    const r = this.deps.db.friendRequests.get(requestId);
    if (!r || r.fromId !== userId) throw notFound('no such request', 'request_not_found');
    if (r.status !== 'pending') throw conflict('that request was already answered', 'request_closed');
    this.deps.db.friendRequests.update(r.id, { status: 'cancelled', respondedAt: this.deps.clock() });
  }

  /** Removes a friend, both ways. */
  remove(userId: string, friendId: string): void {
    if (!this.deps.db.friends.has(userId, friendId)) throw notFound('not on your friends list', 'not_friends');
    this.deps.db.friends.unlink(userId, friendId);
  }

  // ---------------------------------------------------------------------------
  // WhatsApp invites
  // ---------------------------------------------------------------------------

  /**
   * A signed invite code. It carries who sent it and when, so opening the link is enough to send
   * the request back — the recipient never has to type a nickname. Signed because the link travels
   * through WhatsApp, where anyone could otherwise edit the sender out of it.
   */
  private sign(userId: string, issuedAt: number): string {
    const body = `${userId}.${issuedAt}`;
    const mac = createHmac('sha256', this.deps.secret).update(`invite:${body}`).digest('base64url').slice(0, 27);
    return `${Buffer.from(body).toString('base64url')}.${mac}`;
  }

  /**
   * A shareable invite. `origin` is the address this request arrived on; it is what makes the link
   * absolute, which matters because the link travels through WhatsApp, where a relative path is
   * not just ugly but unusable — the recipient has nothing to resolve it against.
   */
  createInvite(userId: string, origin = ''): { code: string; url: string; whatsappUrl: string; text: string; expiresAt: number } {
    const now = this.deps.clock();
    const code = this.sign(userId, now);
    const nickname = this.deps.db.users.get(userId)?.nickname ?? '';
    // A trailing slash would make this `//#/invite/...`, which browsers read as protocol-relative
    // and point at a host that does not exist.
    const base = (this.deps.publicUrl || origin || '').replace(/\/+$/, '');
    const url = `${base}/#/invite/${code}`;
    const text = `${nickname} wants to battle you in Tank 1990! ${url}`;
    return {
      code,
      url,
      // wa.me is WhatsApp's own share endpoint: it opens the app with the message pre-filled and
      // lets the sender pick the contact, so the game never sees anyone's phone number.
      whatsappUrl: `https://wa.me/?text=${encodeURIComponent(text)}`,
      text,
      expiresAt: now + INVITE_TTL_MS,
    };
  }

  /** Verifies an invite code and returns who issued it. */
  readInvite(code: string): { userId: string; issuedAt: number } {
    const [bodyB64, mac] = code.split('.');
    if (!bodyB64 || !mac) throw badRequest('that invite link is not valid', 'bad_invite');
    const body = Buffer.from(bodyB64, 'base64url').toString('utf8');
    const expected = createHmac('sha256', this.deps.secret).update(`invite:${body}`).digest('base64url').slice(0, 27);
    const a = Buffer.from(mac);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw badRequest('that invite link is not valid', 'bad_invite');
    const [userId, issuedAtRaw] = body.split('.');
    const issuedAt = Number(issuedAtRaw);
    if (!userId || !Number.isFinite(issuedAt)) throw badRequest('that invite link is not valid', 'bad_invite');
    if (this.deps.clock() - issuedAt > INVITE_TTL_MS) throw badRequest('that invite link has expired', 'invite_expired');
    return { userId, issuedAt };
  }

  /** Opens an invite link: sends a request back to whoever shared it. */
  acceptInvite(userId: string, code: string): { status: 'sent' | 'accepted' | 'already_friends'; nickname: string } {
    const { userId: inviterId } = this.readInvite(code);
    const inviter = this.deps.db.users.get(inviterId);
    if (!inviter) throw notFound('that player no longer exists', 'player_not_found');
    if (inviter.id === userId) throw badRequest('that is your own invite link', 'self_invite');
    if (this.deps.db.friends.has(userId, inviter.id)) return { status: 'already_friends', nickname: inviter.nickname };
    const r = this.request(userId, inviter.nickname);
    return { status: r.status, nickname: inviter.nickname };
  }
}
