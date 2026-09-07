import { createPublicKey, createVerify, type JsonWebKey } from 'node:crypto';

/**
 * Google Sign-In verification.
 *
 * The client runs Google's own sign-in flow and sends us the resulting ID token. That token is a
 * JWT signed by Google, so we can trust it without ever holding the user's password — provided we
 * actually check all of it: the signature against Google's published keys, the issuer, the audience
 * (our own client id, or anyone's token would be accepted), and the expiry.
 */

const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
/** Tolerance for clock skew between us and Google, in seconds. */
const CLOCK_SKEW = 60;

export interface GoogleProfile {
  /** Google's stable, unique account id. This — not the email — is the identity key. */
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  picture?: string;
  locale?: string;
}

interface Jwk {
  kid: string;
  kty: string;
  alg?: string;
  use?: string;
  n: string;
  e: string;
}

export class GoogleAuthError extends Error {
  constructor(
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'GoogleAuthError';
  }
}

const b64uToBuf = (s: string): Buffer => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const b64uToJson = <T>(s: string): T => JSON.parse(b64uToBuf(s).toString('utf8')) as T;

type Fetcher = typeof fetch;

/**
 * Caches Google's signing keys. They rotate every few days and the endpoint sends a `max-age`, so
 * the cache is refreshed on expiry — and immediately if a token names a key we have not seen, which
 * is what a rotation looks like from here.
 */
export class GoogleKeyStore {
  private keys = new Map<string, Jwk>();
  private expiresAt = 0;
  private inflight: Promise<void> | null = null;

  constructor(
    private readonly fetchImpl: Fetcher = fetch,
    private readonly now: () => number = Date.now,
    private readonly url = GOOGLE_JWKS_URL,
  ) {}

  async get(kid: string): Promise<Jwk | undefined> {
    if (this.now() >= this.expiresAt || !this.keys.has(kid)) await this.refresh();
    return this.keys.get(kid);
  }

  private async refresh(): Promise<void> {
    // One fetch even if several sign-ins land at once.
    if (this.inflight) return this.inflight;
    this.inflight = (async () => {
      const res = await this.fetchImpl(this.url);
      if (!res.ok) throw new GoogleAuthError('jwks_unavailable', `Google key endpoint returned ${res.status}`);
      const body = (await res.json()) as { keys?: Jwk[] };
      const keys = body.keys ?? [];
      if (!keys.length) throw new GoogleAuthError('jwks_empty', 'Google key endpoint returned no keys');
      this.keys = new Map(keys.map((k) => [k.kid, k]));
      const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '')?.[1] ?? 3600);
      this.expiresAt = this.now() + Math.max(60, maxAge) * 1000;
    })().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }
}

export interface GoogleVerifierOptions {
  /** OAuth client id this game is registered as. A token minted for anyone else is rejected. */
  clientId: string;
  keys?: GoogleKeyStore;
  now?: () => number;
}

/** Verifies Google ID tokens end to end. */
export class GoogleVerifier {
  private readonly keys: GoogleKeyStore;
  private readonly now: () => number;

  constructor(private readonly opts: GoogleVerifierOptions) {
    this.keys = opts.keys ?? new GoogleKeyStore();
    this.now = opts.now ?? Date.now;
  }

  async verify(idToken: string): Promise<GoogleProfile> {
    const parts = idToken.split('.');
    if (parts.length !== 3) throw new GoogleAuthError('malformed_token', 'not a JWT');
    const [headerB64, payloadB64, signatureB64] = parts;

    let header: { alg?: string; kid?: string };
    let payload: Record<string, unknown>;
    try {
      header = b64uToJson(headerB64);
      payload = b64uToJson(payloadB64);
    } catch {
      throw new GoogleAuthError('malformed_token', 'token is not valid JSON');
    }

    // Only RS256. Accepting `alg: none`, or an HMAC algorithm keyed by the public key, is the
    // classic JWT forgery, so the algorithm is pinned rather than read from the token.
    if (header.alg !== 'RS256') throw new GoogleAuthError('bad_algorithm', `unsupported alg ${header.alg}`);
    if (!header.kid) throw new GoogleAuthError('malformed_token', 'no key id');

    const jwk = await this.keys.get(header.kid);
    if (!jwk) throw new GoogleAuthError('unknown_key', 'token signed with a key Google does not publish');

    const key = createPublicKey({ key: jwk as unknown as JsonWebKey, format: 'jwk' });
    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${headerB64}.${payloadB64}`);
    verifier.end();
    if (!verifier.verify(key, b64uToBuf(signatureB64))) throw new GoogleAuthError('bad_signature', 'signature does not match');

    const iss = String(payload.iss ?? '');
    if (!GOOGLE_ISSUERS.has(iss)) throw new GoogleAuthError('bad_issuer', `unexpected issuer ${iss}`);

    const aud = payload.aud;
    const audiences = Array.isArray(aud) ? aud.map(String) : [String(aud ?? '')];
    if (!audiences.includes(this.opts.clientId)) throw new GoogleAuthError('bad_audience', 'token was not minted for this game');

    const nowSec = Math.floor(this.now() / 1000);
    const exp = Number(payload.exp ?? 0);
    if (!exp || nowSec > exp + CLOCK_SKEW) throw new GoogleAuthError('expired', 'token has expired');
    const iat = Number(payload.iat ?? 0);
    if (iat && nowSec + CLOCK_SKEW < iat) throw new GoogleAuthError('not_yet_valid', 'token is issued in the future');

    const sub = String(payload.sub ?? '');
    if (!sub) throw new GoogleAuthError('malformed_token', 'no subject');
    const email = String(payload.email ?? '').toLowerCase();
    // Google will happily mint a token for an address the user has not confirmed; treating that as
    // proof of ownership would let someone claim an account by typing a stranger's address.
    const emailVerified = payload.email_verified === true || payload.email_verified === 'true';

    return {
      sub,
      email,
      emailVerified,
      name: payload.name ? String(payload.name) : undefined,
      picture: payload.picture ? String(payload.picture) : undefined,
      locale: payload.locale ? String(payload.locale) : undefined,
    };
  }
}
