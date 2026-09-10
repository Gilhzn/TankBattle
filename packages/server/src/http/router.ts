import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ZodType } from 'zod';
import type { UserRow } from '../db/repo.js';
import { HttpError, badRequest, tooMany, unauthorized } from '../util/errors.js';
import type { Logger } from '../util/log.js';
import { RateLimiter } from '../util/rateLimit.js';
import type { Clock } from '../util/time.js';

export const MAX_BODY_BYTES = 256 * 1024;
const DEV_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  ip: string;
  headers: IncomingMessage['headers'];
  body: unknown;
  rawBody: string;
  /** Present on authenticated routes. */
  user: UserRow;
  status: number;
}

export type Handler = (ctx: Ctx) => Promise<unknown> | unknown;

/**
 * The externally visible origin of this request, e.g. `https://irongrid.onrender.com`.
 *
 * Derived from the proxy headers every PaaS sets, so links the server mints are absolute without
 * anyone having to configure the deployment's own address. `PUBLIC_URL` still overrides it, for the
 * cases the request cannot answer — a custom domain in front of the host, or a link built outside
 * of any request. Returns '' when there is no usable Host header at all.
 */
export function requestOrigin(ctx: Ctx): string {
  const first = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? '') : (v ?? '')).split(',')[0].trim();
  const host = first(ctx.headers['x-forwarded-host']) || first(ctx.headers.host);
  if (!host) return '';
  // A proxy terminates TLS, so the socket itself always looks like plain http from in here.
  const proto = first(ctx.headers['x-forwarded-proto']) || 'http';
  return `${proto}://${host}`;
}

export interface RouteOptions {
  /** Default true. */
  auth?: boolean;
  /** Skip JSON parsing (webhooks). */
  raw?: boolean;
  /** Token cost against the per-user bucket (heavier endpoints cost more). */
  cost?: number;
}

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
  opts: RouteOptions;
}

export interface RouterDeps {
  log: Logger;
  clock: Clock;
  authenticate(token: string): UserRow | null;
  /** Requests per second per IP / per user; generous defaults. */
  limits?: { ipPerSec?: number; ipBurst?: number; userPerSec?: number; userBurst?: number; authFailPerMin?: number };
}

function compile(path: string): { pattern: RegExp; keys: string[] } {
  const keys: string[] = [];
  const src = path
    .split('/')
    .map((seg) => {
      if (seg.startsWith(':')) {
        keys.push(seg.slice(1));
        return '([^/]+)';
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { pattern: new RegExp(`^${src}/?$`), keys };
}

/** Tiny method+pattern router with JSON bodies, bearer auth, CORS for dev and token-bucket limits. */
export class Router {
  private routes: Route[] = [];
  private ipLimiter: RateLimiter;
  private userLimiter: RateLimiter;
  private authFailLimiter: RateLimiter;

  constructor(private readonly deps: RouterDeps) {
    const l = deps.limits ?? {};
    this.ipLimiter = new RateLimiter({ capacity: l.ipBurst ?? 80, refillPerSec: l.ipPerSec ?? 40 }, deps.clock);
    this.userLimiter = new RateLimiter({ capacity: l.userBurst ?? 60, refillPerSec: l.userPerSec ?? 30 }, deps.clock);
    this.authFailLimiter = new RateLimiter({ capacity: l.authFailPerMin ?? 20, refillPerSec: (l.authFailPerMin ?? 20) / 60 }, deps.clock);
  }

  add(method: string, path: string, handler: Handler, opts: RouteOptions = {}): this {
    this.routes.push({ method: method.toUpperCase(), handler, opts, ...compile(path) });
    return this;
  }
  get(path: string, handler: Handler, opts?: RouteOptions): this {
    return this.add('GET', path, handler, opts);
  }
  post(path: string, handler: Handler, opts?: RouteOptions): this {
    return this.add('POST', path, handler, opts);
  }
  patch(path: string, handler: Handler, opts?: RouteOptions): this {
    return this.add('PATCH', path, handler, opts);
  }
  delete(path: string, handler: Handler, opts?: RouteOptions): this {
    return this.add('DELETE', path, handler, opts);
  }

  /** Handles the request; returns false when no route matched (caller may serve static files). */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const method = (req.method ?? 'GET').toUpperCase();
    this.cors(req, res);
    if (method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
      res.writeHead(204).end();
      return true;
    }
    let matched: Route | undefined;
    let params: Record<string, string> = {};
    let pathExists = false;
    for (const r of this.routes) {
      const m = r.pattern.exec(url.pathname);
      if (!m) continue;
      pathExists = true;
      if (r.method !== method) continue;
      matched = r;
      params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      break;
    }
    if (!matched) {
      if (pathExists) {
        this.sendError(res, new HttpError(405, 'method_not_allowed', `${method} not allowed`));
        return true;
      }
      if (url.pathname.startsWith('/api/')) {
        this.sendError(res, new HttpError(404, 'not_found', 'no such endpoint'));
        return true;
      }
      return false;
    }
    const ip = clientIp(req);
    try {
      if (!this.ipLimiter.take(ip)) throw tooMany();
      const ctx = { req, res, method, path: url.pathname, params, query: url.searchParams, ip, headers: req.headers, body: undefined as unknown, rawBody: '', status: 200 } as Ctx;
      if (matched.opts.auth !== false) ctx.user = this.authUser(req, ip);
      if (ctx.user && !this.userLimiter.take(ctx.user.id, matched.opts.cost ?? 1)) throw tooMany();
      ctx.rawBody = await readBody(req);
      if (!matched.opts.raw && ctx.rawBody.length > 0) {
        try {
          ctx.body = JSON.parse(ctx.rawBody);
        } catch {
          throw badRequest('invalid json body', 'bad_json');
        }
      }
      const result = await matched.handler(ctx);
      if (res.writableEnded) return true;
      sendJson(res, ctx.status, result ?? {});
    } catch (err) {
      this.sendError(res, err);
    }
    return true;
  }

  private authUser(req: IncomingMessage, ip: string): UserRow {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const user = token ? this.deps.authenticate(token) : null;
    if (!user) {
      if (!this.authFailLimiter.take(ip)) throw tooMany('too many failed authentications');
      throw unauthorized(token ? 'invalid or expired token' : 'missing bearer token');
    }
    return user;
  }

  private cors(req: IncomingMessage, res: ServerResponse): void {
    const origin = req.headers.origin;
    if (!origin || !DEV_ORIGIN.test(origin)) return;
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Max-Age', '600');
  }

  private sendError(res: ServerResponse, err: unknown): void {
    if (err instanceof HttpError) {
      sendJson(res, err.status, { error: { code: err.code, message: err.message } });
      return;
    }
    this.deps.log.error('unhandled route error', err);
    sendJson(res, 500, { error: { code: 'internal', message: 'internal server error' } });
  }
}

export function clientIp(req: IncomingMessage): string {
  const fwd = req.headers['x-forwarded-for'];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();
  return first || req.socket.remoteAddress || 'unknown';
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(text), 'Cache-Control': 'no-store' });
  res.end(text);
}

function readBody(req: IncomingMessage, limit = MAX_BODY_BYTES): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, 'payload_too_large', `body exceeds ${limit} bytes`));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** Validates a JSON body with a zod schema → 400 `bad_request` with the first issue. */
export function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body ?? {});
  if (!r.success) {
    const issue = r.error.issues[0];
    throw badRequest(issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'invalid body', 'validation');
  }
  return r.data;
}
