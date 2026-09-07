import { createReadStream, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8', '.wasm': 'application/wasm',
};

/** Serves a built SPA from `root`: static files, then index.html for unknown paths. Never leaves `root`. */
export function serveStatic(root: string, req: IncomingMessage, res: ServerResponse): void {
  const method = req.method ?? 'GET';
  if (method !== 'GET' && method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  const base = resolve(root);
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  const rel = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  let file = resolve(join(base, rel));
  if (file !== base && !file.startsWith(base + sep)) {
    res.writeHead(403).end();
    return;
  }
  const send = (path: string, cache: string) => {
    let st;
    try {
      st = statSync(path);
    } catch {
      return false;
    }
    if (!st.isFile()) return false;
    res.writeHead(200, { 'Content-Type': TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': cache });
    if (method === 'HEAD') res.end();
    else createReadStream(path).pipe(res);
    return true;
  };
  if (file === base) file = join(base, 'index.html');
  const hashed = /\/assets\//.test(pathname) || /[.-][0-9a-f]{8,}\./i.test(pathname);
  if (send(file, hashed ? 'public, max-age=31536000, immutable' : 'no-cache')) return;
  if (extname(pathname) === '' && send(join(base, 'index.html'), 'no-cache')) return;
  res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
}
