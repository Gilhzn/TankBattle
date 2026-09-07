import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import type { Db, IdentityRow, UserRow } from '../db/repo.js';
import { badRequest, conflict, tooMany, unauthorized } from '../util/errors.js';
import { newId } from '../util/ids.js';
import type { Logger } from '../util/log.js';
import type { Clock } from '../util/time.js';
import { sign } from './tokens.js';
import { checkEmail, type MxLookup } from './email.js';
import type { GoogleVerifier } from './google.js';
import { verificationMail, type Mailer } from './mailer.js';
import { userDto, type UserDTO, type UserService } from './users.js';

/** How long an emailed code stays valid. Long enough to switch apps, short enough to be useless later. */
const CODE_TTL_MS = 15 * 60_000;
/** Wrong guesses allowed before the challenge is burned. */
const MAX_CODE_ATTEMPTS = 5;
/** One code per address per this window, so the endpoint cannot be used to spam an inbox. */
const CODE_RESEND_MS = 60_000;

const hashCode = (email: string, code: string): string => createHash('sha256').update(`${email}:${code}`).digest('hex');

/** Constant-time compare so a wrong code cannot be found by timing the response. */
function sameHash(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export interface AccountsDeps {
  db: Db;
  users: UserService;
  secret: string;
  clock: Clock;
  log: Logger;
  mailer: Mailer;
  google?: GoogleVerifier;
  mx?: MxLookup;
}

export interface AuthResult {
  token: string;
  user: UserDTO;
  isNew: boolean;
  /** Set when the account still needs a nickname of its own before it can be seen by other players. */
  needsNickname: boolean;
}

/**
 * Sign-in and account linking.
 *
 * A player may arrive as a guest (device token), through Google, or through a verified email, and
 * all three land on one user record: signing in with Google on a device that already has a guest
 * account upgrades that account in place rather than stranding its progress behind a second one.
 */
export class AccountService {
  constructor(private readonly deps: AccountsDeps) {}

  private issue(user: UserRow, isNew: boolean): AuthResult {
    const now = this.deps.clock();
    return { token: sign(this.deps.secret, user.id, now), user: userDto(user), isNew, needsNickname: !user.nicknameLc };
  }

  /**
   * Attaches an identity to a user, creating the user when the identity is new.
   * `linkTo` is the signed-in account to attach to, for a guest upgrading in place.
   */
  private upsert(provider: IdentityRow['provider'], subject: string, email: string, emailVerified: boolean, linkTo?: string, country?: string): AuthResult {
    const now = this.deps.clock();
    return this.deps.db.transaction(() => {
      const existing = this.deps.db.identities.get(provider, subject);
      if (existing) {
        // Known identity: it wins over whatever guest account this device happens to hold, so a
        // player signing in on a friend's phone gets their own account, not their friend's.
        this.deps.db.identities.update(existing.id, { lastLoginAt: now, email, emailVerified });
        const user = this.deps.db.users.get(existing.userId);
        if (!user) throw unauthorized('account no longer exists', 'account_missing');
        const patch: Partial<UserRow> = { lastSeen: now };
        if (country && !user.country) patch.country = country;
        return this.issue(this.deps.db.users.update(user.id, patch), false);
      }

      // New identity. Attach it to the signed-in guest when there is one, so their coins, skins and
      // battle-pass progress survive the upgrade.
      let user = linkTo ? this.deps.db.users.get(linkTo) : undefined;
      let isNew = false;
      if (user) {
        // A user may hold one identity per provider; a second Google account has to be its own user.
        if (this.deps.db.identities.listForUser(user.id).some((i) => i.provider === provider)) {
          throw conflict('this account is already linked to a different sign-in', 'already_linked');
        }
      } else {
        user = this.deps.users.createBlank(country ?? '');
        isNew = true;
      }
      this.deps.db.identities.insert({
        id: newId(), userId: user.id, provider, subject, email, emailVerified, createdAt: now, lastLoginAt: now,
      });
      if (country && !user.country) user = this.deps.db.users.update(user.id, { country });
      return this.issue(user, isNew);
    });
  }

  /** Signs in with a Google ID token minted by the client's Google Sign-In flow. */
  async google(idToken: string, linkTo?: string, country?: string): Promise<AuthResult> {
    const verifier = this.deps.google;
    if (!verifier) throw badRequest('Google sign-in is not configured on this server', 'google_unconfigured');
    const profile = await verifier.verify(idToken);
    if (!profile.emailVerified) throw unauthorized('this Google account has no confirmed email address', 'google_email_unverified');
    return this.upsert('google', profile.sub, profile.email, true, linkTo, country);
  }

  /**
   * Starts email sign-in: vets the address and mails a code. Deliberately reports success even for
   * an address that is already registered — whether an address has an account is not something an
   * anonymous caller should be able to probe.
   */
  async startEmail(rawEmail: string, linkTo?: string, lang: 'en' | 'he' = 'en'): Promise<{ sent: true; expiresAt: number }> {
    const check = await checkEmail(rawEmail, this.deps.mx);
    if (!check.ok) {
      const messages: Record<string, string> = {
        malformed: 'that does not look like an email address',
        disposable: 'temporary and throwaway email addresses are not accepted',
        role_account: 'please use a personal address, not a shared mailbox',
        undeliverable: 'that domain cannot receive email',
      };
      throw badRequest(messages[check.reason ?? 'malformed'] ?? 'invalid email', `email_${check.reason}`);
    }
    const email = check.normalized;
    const now = this.deps.clock();
    if (this.deps.db.emailCodes.countSince(email, now - CODE_RESEND_MS) > 0) {
      throw tooMany('a code was just sent to that address — check your inbox', 'code_recently_sent');
    }
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    this.deps.db.emailCodes.put({
      email, codeHash: hashCode(email, code), userId: linkTo ?? null, expiresAt: now + CODE_TTL_MS, attempts: 0, createdAt: now,
    });
    await this.deps.mailer.send(verificationMail(email, code, lang));
    return { sent: true, expiresAt: now + CODE_TTL_MS };
  }

  /** Completes email sign-in. The address is only trusted once the code proves the player reads it. */
  verifyEmail(rawEmail: string, code: string, country?: string): AuthResult {
    const email = rawEmail.trim().toLowerCase();
    const now = this.deps.clock();
    const row = this.deps.db.emailCodes.get(email);
    if (!row) throw unauthorized('ask for a new code', 'no_pending_code');
    if (row.expiresAt <= now) {
      this.deps.db.emailCodes.remove(email);
      throw unauthorized('that code has expired', 'code_expired');
    }
    if (row.attempts >= MAX_CODE_ATTEMPTS) {
      this.deps.db.emailCodes.remove(email);
      throw tooMany('too many wrong codes — ask for a new one', 'too_many_attempts');
    }
    if (!sameHash(row.codeHash, hashCode(email, code.trim()))) {
      this.deps.db.emailCodes.put({ ...row, attempts: row.attempts + 1 });
      throw unauthorized('that code is not right', 'bad_code');
    }
    this.deps.db.emailCodes.remove(email);
    return this.upsert('email', email, email, true, row.userId ?? undefined, country);
  }

  /** The sign-in methods attached to an account, for the profile screen. */
  identities(userId: string): Array<{ provider: string; email: string; createdAt: number }> {
    return this.deps.db.identities.listForUser(userId).map((i) => ({ provider: i.provider, email: i.email, createdAt: i.createdAt }));
  }

  /** True when the account has any real sign-in and is therefore recoverable on another device. */
  isRegistered(userId: string): boolean {
    return this.deps.db.identities.listForUser(userId).length > 0;
  }
}
