import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RunningServer } from '../src/server.js';
import { guest, startTestServer } from './helpers.js';

let server: RunningServer;
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tank-static-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Tank</title>');
  writeFileSync(join(dir, 'assets', 'app-abcdef12.js'), 'console.log(1)');
  writeFileSync(join(dir, '..', 'secret.txt'), 'nope');
  server = await startTestServer({ staticDir: dir });
});
afterAll(async () => {
  await server.close();
});

describe('static + http plumbing', () => {
  it('serves the SPA with fallback, content types and no traversal', async () => {
    const index = await fetch(server.url + '/');
    expect(index.status).toBe(200);
    expect(index.headers.get('content-type')).toContain('text/html');
    const deep = await fetch(server.url + '/play/room/ABCDE');
    expect(deep.status).toBe(200);
    expect(await deep.text()).toContain('Tank');
    const js = await fetch(server.url + '/assets/app-abcdef12.js');
    expect(js.headers.get('content-type')).toContain('javascript');
    expect(js.headers.get('cache-control')).toContain('immutable');
    expect((await fetch(server.url + '/missing.png')).status).toBe(404);
    expect((await fetch(server.url + '/../secret.txt')).status).not.toBe(200);
    expect((await fetch(server.url + '/%2e%2e/secret.txt')).status).not.toBe(200);
    expect((await fetch(server.url + '/assets/..%2f..%2fsecret.txt')).status).not.toBe(200);
  });

  it('answers CORS preflight for the Vite dev origin only', async () => {
    const ok = await fetch(server.url + '/api/me', { method: 'OPTIONS', headers: { origin: 'http://localhost:5173' } });
    expect(ok.status).toBe(204);
    expect(ok.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    const other = await fetch(server.url + '/api/health', { headers: { origin: 'https://evil.example' } });
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('rejects oversized bodies and wrong methods', async () => {
    const u = await guest(server);
    const big = await fetch(server.url + '/api/me', { method: 'PATCH', headers: { authorization: `Bearer ${u.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ settings: { blob: 'x'.repeat(300 * 1024) } }) }).catch(() => null);
    expect(big === null || big.status === 413).toBe(true);
    expect((await u.call('GET', '/api/store/purchase')).status).toBe(405);
    expect((await u.call('POST', '/api/store/webhook/stripe', {})).status).toBe(404);
    const settings = await u.call<{ user: { settings: Record<string, unknown> } }>('PATCH', '/api/me', { settings: { music: 0.5 } });
    expect(settings.body.user.settings).toEqual({ music: 0.5 });
  });
});
