/* Tank 1990 Online — hand-written service worker.
 * cache-first for the precached app shell, network-first with cache fallback for navigations,
 * network-only for /api and /ws. The cache name changes per build (asset-manifest.json carries the version). */
const SHELL = ['/', '/index.html', '/manifest.webmanifest'];
let cacheName = 'tank1990-shell';

async function readManifest() {
  try {
    const res = await fetch('/asset-manifest.json', { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const manifest = await readManifest();
      const version = manifest?.version || 'dev';
      cacheName = 'tank1990-' + version;
      const cache = await caches.open(cacheName);
      const files = new Set([...SHELL, ...(manifest?.files || [])]);
      await Promise.all(
        [...files].map(async (f) => {
          try {
            await cache.add(new Request(f, { cache: 'reload' }));
          } catch {
            /* optional asset, ignore */
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('tank1990-') && k !== cacheName).map((k) => caches.delete(k)));
      await self.clients.claim();
      const clients = await self.clients.matchAll({ type: 'window' });
      for (const c of clients) c.postMessage({ type: 'sw-updated', version: cacheName });
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/ws')) return; // network only

  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(cacheName);
          cache.put('/index.html', fresh.clone());
          return fresh;
        } catch {
          const cached = (await caches.match('/index.html')) || (await caches.match('/'));
          return cached || new Response('offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
        }
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      try {
        const fresh = await fetch(req);
        if (fresh.ok && (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/'))) {
          const cache = await caches.open(cacheName);
          cache.put(req, fresh.clone());
        }
        return fresh;
      } catch {
        return new Response('', { status: 504 });
      }
    })(),
  );
});
