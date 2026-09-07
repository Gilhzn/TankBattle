import { describe, expect, it } from 'vitest';
import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { GoogleKeyStore, GoogleVerifier } from '../src/auth/google.js';

const CLIENT_ID = '1234.apps.googleusercontent.com';
const KID = 'test-key-1';
const NOW = 1_800_000_000_000;
const nowSec = Math.floor(NOW / 1000);

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });

const b64u = (b: Buffer | string): string => Buffer.from(b).toString('base64url');

/** Mints a JWT the way Google would, so the verifier can be tested without the network. */
function mintToken(payload: Record<string, unknown>, key: KeyObject = privateKey, header: Record<string, unknown> = {}): string {
  const h = b64u(JSON.stringify({ alg: 'RS256', kid: KID, typ: 'JWT', ...header }));
  const p = b64u(JSON.stringify(payload));
  const signer = createSign('RSA-SHA256');
  signer.update(`${h}.${p}`);
  signer.end();
  return `${h}.${p}.${signer.sign(key).toString('base64url')}`;
}

const validPayload = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  iss: 'https://accounts.google.com',
  aud: CLIENT_ID,
  sub: '110000000000000000001',
  email: 'player@gmail.com',
  email_verified: true,
  name: 'A Player',
  iat: nowSec - 10,
  exp: nowSec + 3600,
  ...over,
});

/** JWKS endpoint stub serving our test key. */
function jwks(keys: KeyObject[] = [publicKey], onFetch?: () => void): typeof fetch {
  return (async () => {
    onFetch?.();
    const body = { keys: keys.map((k) => ({ ...(k.export({ format: 'jwk' }) as object), kid: KID, alg: 'RS256', use: 'sig' })) };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'cache-control': 'max-age=3600' } });
  }) as unknown as typeof fetch;
}

const verifier = (fetchImpl = jwks()): GoogleVerifier =>
  new GoogleVerifier({ clientId: CLIENT_ID, now: () => NOW, keys: new GoogleKeyStore(fetchImpl, () => NOW, 'https://keys.test/certs') });

describe('Google ID token verification', () => {
  it('accepts a properly signed token and reads the profile off it', async () => {
    const profile = await verifier().verify(mintToken(validPayload()));
    expect(profile).toMatchObject({ sub: '110000000000000000001', email: 'player@gmail.com', emailVerified: true, name: 'A Player' });
  });

  it('accepts the bare issuer spelling Google also uses', async () => {
    await expect(verifier().verify(mintToken(validPayload({ iss: 'accounts.google.com' })))).resolves.toBeTruthy();
  });

  it('rejects a token signed by someone else', async () => {
    await expect(verifier().verify(mintToken(validPayload(), other.privateKey))).rejects.toThrow(/signature/i);
  });

  it('rejects a token minted for a different app', async () => {
    await expect(verifier().verify(mintToken(validPayload({ aud: 'someone-else.apps.googleusercontent.com' })))).rejects.toThrow(/not minted for this game/i);
  });

  it('rejects a token from the wrong issuer', async () => {
    await expect(verifier().verify(mintToken(validPayload({ iss: 'https://evil.example.com' })))).rejects.toThrow(/issuer/i);
  });

  it('rejects an expired token', async () => {
    await expect(verifier().verify(mintToken(validPayload({ exp: nowSec - 3600 })))).rejects.toThrow(/expired/i);
  });

  it('rejects "alg: none", the classic JWT forgery', async () => {
    const h = b64u(JSON.stringify({ alg: 'none', kid: KID }));
    const p = b64u(JSON.stringify(validPayload()));
    await expect(verifier().verify(`${h}.${p}.`)).rejects.toThrow(/unsupported alg/i);
  });

  it('rejects an HMAC-signed token, which would let the public key act as a secret', async () => {
    await expect(verifier().verify(mintToken(validPayload(), privateKey, { alg: 'HS256' }))).rejects.toThrow(/unsupported alg/i);
  });

  it('rejects anything that is not a three-part JWT', async () => {
    await expect(verifier().verify('not.a.jwt.at.all')).rejects.toThrow(/not a JWT/i);
    await expect(verifier().verify('garbage')).rejects.toThrow(/not a JWT/i);
  });

  it('rejects a token signed with a key Google does not publish', async () => {
    const v = new GoogleVerifier({
      clientId: CLIENT_ID,
      now: () => NOW,
      keys: new GoogleKeyStore(jwks([other.publicKey]), () => NOW, 'https://keys.test/certs'),
    });
    // Same kid, different key material: the signature check is what catches this.
    await expect(v.verify(mintToken(validPayload()))).rejects.toThrow(/signature/i);
  });

  it('reports an unconfirmed Google email rather than trusting it', async () => {
    const profile = await verifier().verify(mintToken(validPayload({ email_verified: false })));
    expect(profile.emailVerified).toBe(false);
  });
});

describe('the Google key cache', () => {
  it('fetches once and reuses the keys', async () => {
    let fetches = 0;
    const v = verifier(jwks([publicKey], () => fetches++));
    await v.verify(mintToken(validPayload()));
    await v.verify(mintToken(validPayload({ sub: '2' })));
    expect(fetches).toBe(1);
  });

  it('refetches when a token names a key it has not seen, which is what rotation looks like', async () => {
    let fetches = 0;
    const store = new GoogleKeyStore(jwks([publicKey], () => fetches++), () => NOW, 'https://keys.test/certs');
    await store.get(KID);
    await store.get('a-kid-we-have-never-seen');
    expect(fetches).toBe(2);
  });
});
