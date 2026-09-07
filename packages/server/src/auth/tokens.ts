import { createHmac, timingSafeEqual } from 'node:crypto';

/** HS256 "JWT-shaped" token: base64url(header).base64url(payload).base64url(hmac). */
export interface TokenPayload {
  sub: string;
  iat: number;
  exp: number;
}

export const TOKEN_TTL_MS = 30 * 86_400_000;
const HEADER = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');

function hmac(secret: string, data: string): Buffer {
  return createHmac('sha256', secret).update(data).digest();
}

export function sign(secret: string, sub: string, now = Date.now(), ttlMs = TOKEN_TTL_MS): string {
  const payload: TokenPayload = { sub, iat: Math.floor(now / 1000), exp: Math.floor((now + ttlMs) / 1000) };
  const body = `${HEADER}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
  return `${body}.${hmac(secret, body).toString('base64url')}`;
}

/** Returns the payload when the signature is valid and the token is not expired; otherwise null. */
export function verify(secret: string, token: string, now = Date.now()): TokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  const expected = hmac(secret, `${h}.${p}`);
  let given: Buffer;
  try {
    given = Buffer.from(s, 'base64url');
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8')) as { alg?: string };
    if (header.alg !== 'HS256') return null;
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8')) as Partial<TokenPayload>;
    if (typeof payload.sub !== 'string' || typeof payload.exp !== 'number' || typeof payload.iat !== 'number') return null;
    if (payload.exp * 1000 <= now) return null;
    return { sub: payload.sub, iat: payload.iat, exp: payload.exp };
  } catch {
    return null;
  }
}
