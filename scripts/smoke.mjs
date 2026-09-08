#!/usr/bin/env node
/**
 * Smoke-tests a deployed Tank 1990 server end to end.
 *
 *   node scripts/smoke.mjs https://tank1990.onrender.com
 *
 * Checks the things a deploy can plausibly break without failing the build: the process is up, the
 * database opened, guest auth issues a usable token, the authenticated routes answer, and invite
 * links come out absolute. Exits non-zero if any check fails, so it can gate a release.
 *
 * The first request uses a long timeout on purpose — a free-tier host that has gone to sleep takes
 * the better part of a minute to answer, and that is a cold start, not a failure.
 */

const base = (process.argv[2] ?? '').replace(/\/+$/, '');
if (!base) {
  console.error('usage: node scripts/smoke.mjs <base-url>');
  process.exit(2);
}

const COLD_START_MS = 90_000;
const NORMAL_MS = 15_000;

let failures = 0;
let token = null;

const pass = (name, detail = '') => console.log(`  ok   ${name}${detail ? ` — ${detail}` : ''}`);
const fail = (name, detail) => {
  failures++;
  console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
};

async function call(method, path, body, { timeoutMs = NORMAL_MS, auth = true } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(base + path, {
      method,
      headers: {
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(auth && token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* leave null; the check reports the status instead */
    }
    return { status: res.status, json, text };
  } finally {
    clearTimeout(timer);
  }
}

/** Runs one check; a thrown error is a failure rather than a crash. */
async function check(name, fn) {
  try {
    const detail = await fn();
    pass(name, detail);
  } catch (err) {
    fail(name, err instanceof Error ? err.message : String(err));
  }
}

console.log(`\nSmoke-testing ${base}\n`);

await check('server is up (allow up to 90s for a cold start)', async () => {
  const t0 = Date.now();
  const r = await call('GET', '/api/health', undefined, { timeoutMs: COLD_START_MS, auth: false });
  if (r.status !== 200 || r.json?.ok !== true) throw new Error(`status ${r.status}`);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  return `${secs}s, ${r.json.rooms} rooms, ${r.json.players} players`;
});

await check('sign-in methods reported', async () => {
  const r = await call('GET', '/api/auth/methods', undefined, { auth: false });
  if (r.status !== 200) throw new Error(`status ${r.status}`);
  const m = r.json;
  return `google=${m.google}, email delivers=${m.emailDelivers}`;
});

await check('guest auth issues a token', async () => {
  const r = await call('POST', '/api/auth/guest', { deviceToken: `smoke-${Date.now()}-${Math.random().toString(36).slice(2)}` }, { auth: false });
  if (r.status !== 200 || !r.json?.token) throw new Error(`status ${r.status}: ${r.text.slice(0, 120)}`);
  token = r.json.token;
  return `nickname ${r.json.user.nickname}`;
});

await check('/api/me answers with that token', async () => {
  const r = await call('GET', '/api/me');
  if (r.status !== 200) throw new Error(`status ${r.status}`);
  return `${r.json.wallet.coins} coins, ${r.json.wallet.gems} gems`;
});

await check('friends list loads', async () => {
  const r = await call('GET', '/api/friends');
  if (r.status !== 200) throw new Error(`status ${r.status}`);
  return `${r.json.friends.length} friends, ${r.json.incoming.length} pending`;
});

await check('profile reports a starting rating', async () => {
  const r = await call('GET', '/api/me/profile');
  if (r.status !== 200) throw new Error(`status ${r.status}`);
  return `rating ${r.json.rating.rating} (${r.json.rating.tier})`;
});

await check('invite link is absolute', async () => {
  const r = await call('GET', '/api/friends/invite');
  if (r.status !== 200) throw new Error(`status ${r.status}`);
  const url = r.json?.url ?? '';
  // A relative link is the failure this check exists for: it survives every build and is only
  // discovered when a real person opens it in WhatsApp and has nothing to tap.
  if (!/^https?:\/\//.test(url)) throw new Error(`relative invite url "${url}" — set PUBLIC_URL or check the proxy headers`);
  if (url.includes('//#/')) throw new Error(`double slash in "${url}" — PUBLIC_URL has a trailing slash`);
  return new URL(url).origin;
});

await check('the client itself is served', async () => {
  const r = await call('GET', '/', undefined, { auth: false });
  if (r.status !== 200) throw new Error(`status ${r.status}`);
  if (!/<title>/i.test(r.text)) throw new Error('response is not the app shell');
  return 'index.html';
});

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
