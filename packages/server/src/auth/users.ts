import { createHash, randomInt } from 'node:crypto';
import { CATALOG_BY_SKU } from '@tank/shared';
import type { Db, UserRow } from '../db/repo.js';
import { conflict } from '../util/errors.js';
import { newId, newNonce } from '../util/ids.js';
import type { Clock } from '../util/time.js';
import { sign } from './tokens.js';

export interface UserDTO {
  id: string;
  nickname: string;
  skin: string;
  createdAt: number;
  settings: Record<string, unknown>;
  country: string;
}

export const userDto = (u: UserRow): UserDTO => ({
  id: u.id, nickname: u.nickname, skin: u.skin, createdAt: u.createdAt, settings: u.settings, country: u.country,
});

/**
 * Nicknames people cannot have. They are the handle friend requests are addressed to, so a name
 * that impersonates the game itself or a moderator would let someone pass themselves off as staff.
 */
const RESERVED_NICKNAMES = new Set([
  'admin', 'administrator', 'moderator', 'mod', 'staff', 'support', 'system', 'server', 'official',
  'irongrid', 'tankbattle', 'anthropic', 'claude', 'me', 'you', 'null', 'undefined', 'deleted', 'bot',
]);

export type NicknameProblem = 'taken' | 'reserved';

/** Why a nickname cannot be used, or null when it is free. */
export function nicknameProblem(db: Db, nickname: string, selfId?: string): NicknameProblem | null {
  const lc = nickname.trim().toLowerCase();
  if (RESERVED_NICKNAMES.has(lc)) return 'reserved';
  const other = db.users.getByNickname(lc);
  if (other && other.id !== selfId) return 'taken';
  return null;
}

const ADJECTIVES = ['Iron', 'Swift', 'Brave', 'Silent', 'Rusty', 'Neon', 'Steel', 'Crimson', 'Frozen', 'Golden', 'Shadow', 'Turbo', 'Wild', 'Lucky', 'Atomic', 'Rogue'];
const NOUNS = ['Tank', 'Cannon', 'Panzer', 'Turret', 'Viper', 'Falcon', 'Badger', 'Wolf', 'Comet', 'Rhino', 'Hornet', 'Raider', 'Bolt', 'Titan', 'Ranger', 'Ace'];

export function randomNickname(): string {
  return `${ADJECTIVES[randomInt(ADJECTIVES.length)]}${NOUNS[randomInt(NOUNS.length)]}${randomInt(10, 99)}`;
}

export function hashDeviceToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Guest accounts keyed by a hashed device token; nicknames unique case-insensitively. */
export class UserService {
  constructor(
    private readonly db: Db,
    private readonly secret: string,
    private readonly clock: Clock,
  ) {}

  get(id: string): UserRow | undefined {
    return this.db.users.get(id);
  }

  /**
   * A free nickname derived from `wanted`, with digits appended on collision.
   * Only ever used for names the game generates: a name the player typed is rejected instead, so
   * they find out it was taken rather than silently becoming "Rusty Wolf4718".
   */
  private uniqueNickname(wanted: string, selfId?: string): string {
    const taken = (n: string) => nicknameProblem(this.db, n, selfId) !== null;
    if (!taken(wanted)) return wanted;
    const base = wanted.slice(0, 12);
    for (let i = 0; i < 50; i++) {
      const candidate = `${base}${randomInt(10, 9999)}`;
      if (!taken(candidate)) return candidate;
    }
    return `${base.slice(0, 8)}${newNonce(4).replace(/[^a-z0-9]/gi, '').slice(0, 6)}`;
  }

  guest(deviceToken: string | undefined, nickname: string | undefined): { token: string; user: UserDTO; isNew: boolean } {
    const now = this.clock();
    const hash = hashDeviceToken(deviceToken ?? `anon:${newNonce(24)}`);
    const result = this.db.transaction(() => {
      const existing = this.db.users.getByDeviceHash(hash);
      if (existing) {
        return { user: this.db.users.update(existing.id, { lastSeen: now }), isNew: false };
      }
      const nick = this.uniqueNickname(nickname?.trim() || randomNickname());
      const user: UserRow = {
        id: newId(), deviceHash: hash, nickname: nick, nicknameLc: nick.toLowerCase(), skin: 'default',
        settings: {}, createdAt: now, lastSeen: now, country: '',
      };
      this.db.users.insert(user);
      return { user, isNew: true };
    });
    return { token: sign(this.secret, result.user.id, now), user: userDto(result.user), isNew: result.isNew };
  }

  touch(id: string): void {
    const u = this.db.users.get(id);
    if (u && this.clock() - u.lastSeen > 60_000) this.db.users.update(id, { lastSeen: this.clock() });
  }

  /**
   * Changes a nickname the player chose themselves. Unlike a generated one this is never quietly
   * altered — the nickname is how friends find each other, so the player has to know which one they
   * actually ended up with.
   */
  setNickname(id: string, nickname: string): UserRow {
    const trimmed = nickname.trim();
    const problem = nicknameProblem(this.db, trimmed, id);
    if (problem === 'taken') throw conflict('that nickname is taken', 'nickname_taken');
    if (problem === 'reserved') throw conflict('that nickname is reserved', 'nickname_reserved');
    return this.db.users.update(id, { nickname: trimmed, nicknameLc: trimmed.toLowerCase() });
  }

  /** Whether a nickname is free, for the "check as you type" endpoint. */
  nicknameAvailable(nickname: string, selfId?: string): { available: boolean; reason?: NicknameProblem } {
    const problem = nicknameProblem(this.db, nickname, selfId);
    return problem ? { available: false, reason: problem } : { available: true };
  }

  /**
   * A fresh account with no device attached — the starting point for a Google or email sign-in on a
   * device that has never played. The device hash is a unique placeholder so the column's uniqueness
   * constraint still holds.
   */
  createBlank(country = ''): UserRow {
    const now = this.clock();
    const nick = this.uniqueNickname(randomNickname());
    const user: UserRow = {
      id: newId(), deviceHash: `account:${newNonce(24)}`, nickname: nick, nicknameLc: nick.toLowerCase(),
      skin: 'default', settings: {}, createdAt: now, lastSeen: now, country,
    };
    this.db.users.insert(user);
    return user;
  }

  setSkin(id: string, skin: string, owned: (sku: string) => boolean): UserRow {
    if (skin !== 'default') {
      const item = CATALOG_BY_SKU[skin];
      if (!item || item.kind !== 'cosmetic' || !skin.startsWith('skin_')) throw conflict('not a skin', 'not_skin');
      if (!owned(skin)) throw conflict('skin not owned', 'not_owned');
    }
    return this.db.users.update(id, { skin });
  }

  setSettings(id: string, settings: Record<string, unknown>): UserRow {
    const cur = this.db.users.get(id)?.settings ?? {};
    const merged = { ...cur, ...settings };
    if (JSON.stringify(merged).length > 8192) throw conflict('settings too large', 'settings_too_large');
    return this.db.users.update(id, { settings: merged });
  }
}
