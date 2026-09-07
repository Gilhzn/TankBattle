import { describe, expect, it } from 'vitest';
import { checkEmail, checkEmailOffline, isDisposableDomain, normalizeEmail } from '../src/auth/email.js';

/** Pretends every domain publishes mail servers, so the offline gates are tested in isolation. */
const alwaysDeliverable = async (): Promise<string[]> => ['mx.example.com'];
const neverDeliverable = async (): Promise<string[]> => [];

describe('email normalisation', () => {
  it('lower-cases the domain', () => {
    expect(normalizeEmail('Player@Example.COM')).toBe('Player@example.com'.toLowerCase());
  });

  it('folds gmail dots and +tags, which all reach one mailbox', () => {
    expect(normalizeEmail('first.last+tank@gmail.com')).toBe('firstlast@gmail.com');
    expect(normalizeEmail('f.i.r.s.t@googlemail.com')).toBe('first@googlemail.com');
  });

  it('leaves other providers alone, where dots are significant', () => {
    expect(normalizeEmail('first.last@fastmail.com')).toBe('first.last@fastmail.com');
    expect(normalizeEmail('first+tag@outlook.com')).toBe('first+tag@outlook.com');
  });
});

describe('disposable domains', () => {
  it('catches the well-known throwaway providers', () => {
    for (const d of ['mailinator.com', 'yopmail.com', 'guerrillamail.com', '10minutemail.com', 'temp-mail.org']) {
      expect(isDisposableDomain(d), d).toBe(true);
    }
  });

  it('catches subdomains they hand out', () => {
    expect(isDisposableDomain('anything.mailinator.com')).toBe(true);
    expect(isDisposableDomain('a.b.yopmail.com')).toBe(true);
  });

  it('leaves real providers alone', () => {
    for (const d of ['gmail.com', 'outlook.com', 'proton.me', 'walla.co.il', 'progis.co.il']) {
      expect(isDisposableDomain(d), d).toBe(false);
    }
  });
});

describe('offline checks', () => {
  it('rejects malformed addresses', () => {
    for (const bad of ['', 'nope', 'a@b', 'no spaces@example.com', 'two@@example.com', '@example.com', 'x@.com']) {
      expect(checkEmailOffline(bad).ok, bad).toBe(false);
    }
  });

  it('rejects throwaway inboxes', () => {
    const r = checkEmailOffline('someone@mailinator.com');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('disposable');
  });

  it('rejects shared role mailboxes', () => {
    expect(checkEmailOffline('support@example.com').reason).toBe('role_account');
    expect(checkEmailOffline('admin@example.com').reason).toBe('role_account');
  });

  it('accepts an ordinary personal address', () => {
    expect(checkEmailOffline('gil@progis.co.il')).toMatchObject({ ok: true, normalized: 'gil@progis.co.il' });
  });
});

describe('deliverability', () => {
  it('accepts a domain that publishes mail servers', async () => {
    await expect(checkEmail('player@example.com', alwaysDeliverable)).resolves.toMatchObject({ ok: true });
  });

  it('rejects a well-formed address at a domain that cannot receive mail', async () => {
    const r = await checkEmail('player@no-mail-here.com', neverDeliverable);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('undeliverable');
  });

  it('treats a failed lookup as undeliverable rather than letting it through', async () => {
    const r = await checkEmail('player@example.com', async () => {
      throw new Error('ENOTFOUND');
    });
    expect(r).toMatchObject({ ok: false, reason: 'undeliverable' });
  });

  it('does not waste a DNS lookup on an address that already failed', async () => {
    let looked = 0;
    await checkEmail('someone@mailinator.com', async () => {
      looked++;
      return ['mx'];
    });
    expect(looked).toBe(0);
  });
});
