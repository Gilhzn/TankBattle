import { resolveMx } from 'node:dns/promises';

/**
 * Email address vetting for sign-up. Three gates, cheapest first:
 *   1. shape — it has to look like an address at all;
 *   2. domain — throwaway inbox providers are refused outright;
 *   3. delivery — the domain must actually publish mail servers.
 * Passing all three still proves nothing about ownership; that is what the emailed code is for.
 */

export type EmailRejection = 'malformed' | 'disposable' | 'undeliverable' | 'role_account';

export interface EmailCheck {
  ok: boolean;
  /** Canonical form to store and compare on. */
  normalized: string;
  reason?: EmailRejection;
}

/**
 * Throwaway inbox providers. These hand out a public, ephemeral mailbox to anyone, which defeats
 * the point of asking for an address: the account cannot be recovered, reported or rate-limited by
 * a real identity. The list is the common providers plus their better-known alias domains — it does
 * not need to be exhaustive to raise the cost of bulk sign-ups well past what it is worth.
 */
const DISPOSABLE_DOMAINS = new Set([
  '0-mail.com', '10minutemail.com', '10minutemail.net', '20minutemail.com', '33mail.com',
  'anonbox.net', 'armyspy.com', 'burnermail.io', 'byom.de',
  'cuvox.de', 'dayrep.com', 'discard.email', 'dispostable.com', 'dropmail.me',
  'einrot.com', 'emailondeck.com', 'emltmp.com', 'ethereal.email',
  'fakeinbox.com', 'fakemail.net', 'fakemailgenerator.com', 'fleckens.hu',
  'gender.pw', 'getairmail.com', 'getnada.com', 'grr.la', 'guerrillamail.com', 'guerrillamail.net',
  'guerrillamail.org', 'guerrillamailblock.com',
  'harakirimail.com', 'inboxbear.com', 'inboxkitten.com', 'incognitomail.com',
  'jetable.org', 'joblistings.co', 'jourrapide.com',
  'kurzepost.de', 'linshiyouxiang.net', 'luxusmail.org',
  'mail-temp.com', 'mail7.io', 'mailcatch.com', 'maildrop.cc', 'mailduck.io', 'mailforspam.com',
  'mailinator.com', 'mailinator.net', 'mailnesia.com', 'mailsac.com', 'mailtemp.info', 'mailtothis.com',
  'meltmail.com', 'minuteinbox.com', 'moakt.com', 'mohmal.com', 'mytemp.email', 'mytrashmail.com',
  'nada.email', 'nowmymail.com', 'objectmail.com', 'onetimemail.org', 'opayq.com',
  'pokemail.net', 'privacy.com', 'proxymail.eu', 'rcpt.at', 'rhyta.com',
  'sharklasers.com', 'shortmail.net', 'spam4.me', 'spambog.com', 'spambox.us', 'spamgourmet.com',
  'superrito.com', 'teleworm.us', 'temp-mail.io', 'temp-mail.org', 'temp-mail.ru', 'tempail.com',
  'tempinbox.com', 'tempm.com', 'tempmail.com', 'tempmail.net', 'tempmail.plus', 'tempmailo.com',
  'tempr.email', 'throwawaymail.com', 'trashmail.com', 'trashmail.de', 'trashmail.me', 'trashmail.net',
  'trbvm.com', 'tmail.ws', 'tmails.net',
  'vomoto.com', 'wegwerfmail.de', 'wegwerfmail.net', 'yopmail.com', 'yopmail.fr', 'yopmail.net',
  'zetmail.com',
]);

/**
 * Shared mailboxes rather than a person. A game account tied to `support@` or `admin@` belongs to
 * whoever reads that inbox this month, which is not an identity we can hold a rating against.
 */
const ROLE_LOCAL_PARTS = new Set([
  'abuse', 'admin', 'administrator', 'billing', 'contact', 'help', 'hostmaster', 'info', 'mail',
  'marketing', 'noreply', 'no-reply', 'postmaster', 'root', 'sales', 'security', 'spam', 'support',
  'webmaster',
]);

/** Domains that ignore dots and `+tags`, so one mailbox can spell itself infinitely many ways. */
const ALIASING_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

// Deliberately stricter than the RFC: one @, no spaces, a dotted domain with a 2+ letter TLD.
const SHAPE = /^[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+)*\.[a-z]{2,24}$/i;

/**
 * Canonical form used for storage and uniqueness. The domain is always lower-cased; on providers
 * that treat addresses as aliases, dots and `+tags` are folded away too, so the same mailbox cannot
 * register twice.
 */
export function normalizeEmail(raw: string): string {
  const trimmed = raw.trim();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0) return trimmed.toLowerCase();
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1).toLowerCase();
  if (!ALIASING_DOMAINS.has(domain)) return `${local.toLowerCase()}@${domain}`;
  const folded = local.toLowerCase().split('+')[0].replace(/\./g, '');
  return `${folded}@${domain}`;
}

export function emailDomain(email: string): string {
  return email.slice(email.lastIndexOf('@') + 1).toLowerCase();
}

export function isDisposableDomain(domain: string): boolean {
  if (DISPOSABLE_DOMAINS.has(domain)) return true;
  // Throwaway providers hand out subdomains freely (`foo.mailinator.com`), so match the parent too.
  const parts = domain.split('.');
  for (let i = 1; i < parts.length - 1; i++) {
    if (DISPOSABLE_DOMAINS.has(parts.slice(i).join('.'))) return true;
  }
  return false;
}

/** Looks up the domain's mail servers. Injected in tests; real DNS otherwise. */
export type MxLookup = (domain: string) => Promise<string[]>;

export const dnsMxLookup: MxLookup = async (domain) => {
  const records = await resolveMx(domain);
  return records.filter((r) => r.exchange && r.exchange !== '.').map((r) => r.exchange);
};

/** Synchronous gates only — shape, role account and the disposable list. */
export function checkEmailOffline(raw: string): EmailCheck {
  const normalized = normalizeEmail(raw);
  if (!SHAPE.test(normalized) || normalized.length > 254) return { ok: false, normalized, reason: 'malformed' };
  const domain = emailDomain(normalized);
  if (isDisposableDomain(domain)) return { ok: false, normalized, reason: 'disposable' };
  if (ROLE_LOCAL_PARTS.has(normalized.slice(0, normalized.lastIndexOf('@')))) return { ok: false, normalized, reason: 'role_account' };
  return { ok: true, normalized };
}

/**
 * Full check, including the DNS lookup. A domain with no MX records cannot receive the verification
 * code, so the address is unusable however well-formed it looks. A lookup that errors for any other
 * reason is treated as undeliverable too — better to ask for another address than to strand the
 * account on an inbox we could never reach.
 */
export async function checkEmail(raw: string, mx: MxLookup = dnsMxLookup): Promise<EmailCheck> {
  const offline = checkEmailOffline(raw);
  if (!offline.ok) return offline;
  try {
    const hosts = await mx(emailDomain(offline.normalized));
    if (!hosts.length) return { ...offline, ok: false, reason: 'undeliverable' };
  } catch {
    return { ...offline, ok: false, reason: 'undeliverable' };
  }
  return offline;
}
