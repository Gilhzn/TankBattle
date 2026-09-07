import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RunningServer } from '../src/server.js';
import { sign, verify } from '../src/auth/tokens.js';
import { TEST_SECRET, api, startTestServer } from './helpers.js';

let server: RunningServer;
beforeAll(async () => {
  server = await startTestServer();
});
afterAll(async () => {
  await server.close();
});

describe('tokens', () => {
  it('round-trips, rejects tampering and expiry', () => {
    const t = sign(TEST_SECRET, 'user-1', 1_000_000);
    expect(verify(TEST_SECRET, t, 2_000_000)?.sub).toBe('user-1');
    expect(verify('other-secret', t, 2_000_000)).toBeNull();
    const [h, p, s] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ sub: 'user-2', iat: 1, exp: 9_999_999_999 })).toString('base64url');
    expect(verify(TEST_SECRET, `${h}.${forged}.${s}`, 2_000_000)).toBeNull();
    expect(verify(TEST_SECRET, `${h}.${p}.${s.slice(0, -2)}xx`, 2_000_000)).toBeNull();
    expect(verify(TEST_SECRET, t, 1_000_000 + 31 * 86_400_000)).toBeNull();
    expect(verify(TEST_SECRET, 'garbage', 0)).toBeNull();
  });
});

describe('guest auth', () => {
  it('creates a guest, reuses it for the same device token', async () => {
    const call = api(server.url);
    const a = await call('POST', '/api/auth/guest', { deviceToken: 'device-token-AAA', nickname: 'Rocket' });
    expect(a.status).toBe(200);
    expect(a.body.isNew).toBe(true);
    const userA = a.body.user as { id: string; nickname: string; skin: string };
    expect(userA.nickname).toBe('Rocket');
    expect(userA.skin).toBe('default');
    const again = await call('POST', '/api/auth/guest', { deviceToken: 'device-token-AAA', nickname: 'Ignored' });
    expect(again.body.isNew).toBe(false);
    expect((again.body.user as { id: string }).id).toBe(userA.id);
    const me = await api(server.url, again.body.token as string)('GET', '/api/me');
    expect(me.status).toBe(200);
    expect((me.body.user as { id: string }).id).toBe(userA.id);
  });

  it('resolves nickname collisions case-insensitively by appending digits', async () => {
    const call = api(server.url);
    const first = await call('POST', '/api/auth/guest', { deviceToken: 'device-token-BBB', nickname: 'Panzer' });
    const second = await call('POST', '/api/auth/guest', { deviceToken: 'device-token-CCC', nickname: 'panzer' });
    const n1 = (first.body.user as { nickname: string }).nickname;
    const n2 = (second.body.user as { nickname: string }).nickname;
    expect(n1).toBe('Panzer');
    expect(n2).not.toBe('Panzer');
    expect(n2).toMatch(/^panzer\d+$/);
    const patch = await api(server.url, second.body.token as string)('PATCH', '/api/me', { nickname: 'PANZER' });
    expect(patch.status).toBe(409);
    const generated = await call('POST', '/api/auth/guest', { deviceToken: 'device-token-DDD' });
    expect((generated.body.user as { nickname: string }).nickname.length).toBeGreaterThanOrEqual(2);
  });

  it('rejects missing, tampered and expired tokens with 401', async () => {
    const call = api(server.url);
    const g = await call('POST', '/api/auth/guest', { deviceToken: 'device-token-EEE' });
    const token = g.body.token as string;
    expect((await api(server.url)('GET', '/api/me')).status).toBe(401);
    expect((await api(server.url, token.slice(0, -3) + 'abc')('GET', '/api/me')).status).toBe(401);
    const sub = (g.body.user as { id: string }).id;
    const expired = sign(TEST_SECRET, sub, Date.now() - 10_000, 1000);
    const res = await api(server.url, expired)('GET', '/api/me');
    expect(res.status).toBe(401);
    expect((res.body.error as { code: string }).code).toBe('unauthorized');
  });

  it('rate-limits repeated failed authentications with 429', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 30; i++) statuses.push((await api(server.url, 'bad.token.value')('GET', '/api/me')).status);
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses).toContain(429);
  });

  it('validates bodies and returns the shared error shape', async () => {
    const res = await api(server.url)('POST', '/api/auth/guest', { nickname: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: 'validation' });
    const bad = await fetch(server.url + '/api/auth/guest', { method: 'POST', body: '{nope', headers: { 'content-type': 'application/json' } });
    expect(bad.status).toBe(400);
    expect((await api(server.url)('GET', '/api/nope')).status).toBe(404);
  });
});
