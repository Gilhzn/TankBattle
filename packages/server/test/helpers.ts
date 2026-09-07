import { PROTOCOL_VERSION, type ClientMessage } from '@tank/shared';
import { WebSocket } from 'ws';
import { startServer, type RunningServer, type StartOptions } from '../src/server.js';

export type Json = Record<string, unknown>;
export type AnyMsg = { type: string } & Record<string, unknown>;

export const TEST_SECRET = 'test-secret-for-vitest-0123456789';

/** In-memory server on a random port; fast ticks and a short countdown for room tests. */
export function startTestServer(extra: StartOptions = {}): Promise<RunningServer> {
  return startServer({
    port: 0,
    dbPath: ':memory:',
    secret: TEST_SECRET,
    provider: 'mock',
    staticDir: null,
    logLevel: 'error',
    countdownMs: 50,
    ...extra,
  });
}

export interface ApiResponse<T = Json> {
  status: number;
  body: T;
}

/** `api(base, token)(method, path, body)` → `{status, body}`. */
export function api(base: string, token?: string) {
  return async <T = Json>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> => {
    const headers: Record<string, string> = {};
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let parsed: unknown = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { raw: text };
    }
    return { status: res.status, body: parsed as T };
  };
}

export interface Guest {
  token: string;
  id: string;
  nickname: string;
  call: ReturnType<typeof api>;
}

/** Registers a fresh guest and returns an authenticated api caller. */
export async function guest(server: RunningServer, nickname?: string, deviceToken?: string): Promise<Guest> {
  const res = await api(server.url)('POST', '/api/auth/guest', { deviceToken: deviceToken ?? `dev-${Math.random().toString(36).slice(2)}-${Date.now()}`, nickname });
  if (res.status !== 200) throw new Error(`guest auth failed: ${JSON.stringify(res.body)}`);
  const body = res.body as { token: string; user: { id: string; nickname: string } };
  return { token: body.token, id: body.user.id, nickname: body.user.nickname, call: api(server.url, body.token) };
}

/** Minimal WS test client with a message queue and `waitFor`. */
export class WsClient {
  private ws: WebSocket | null = null;
  private queue: AnyMsg[] = [];
  private waiters: Array<() => void> = [];
  closed = false;
  closeCode = 0;

  constructor(private readonly url: string) {}

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      ws.on('open', () => resolve());
      ws.on('error', (e) => reject(e));
      ws.on('message', (data) => {
        this.queue.push(JSON.parse(data.toString()) as AnyMsg);
        const ws = this.waiters;
        this.waiters = [];
        for (const w of ws) w();
      });
      ws.on('close', (code) => {
        this.closed = true;
        this.closeCode = code;
        const ws = this.waiters;
        this.waiters = [];
        for (const w of ws) w();
      });
    });
  }

  send(msg: ClientMessage | Json): void {
    this.ws?.send(JSON.stringify(msg));
  }

  sendRaw(text: string): void {
    this.ws?.send(text);
  }

  async hello(token: string): Promise<AnyMsg> {
    this.send({ type: 'hello', token, version: PROTOCOL_VERSION });
    return this.waitFor('welcome');
  }

  /** Resolves with the first queued (or next incoming) message of `type` matching `predicate`. */
  waitFor<T extends AnyMsg = AnyMsg>(type: string, predicate?: (m: T) => boolean, timeoutMs = 5000): Promise<T> {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + timeoutMs;
      const check = (): boolean => {
        const idx = this.queue.findIndex((m) => m.type === type && (!predicate || predicate(m as T)));
        if (idx >= 0) {
          const [m] = this.queue.splice(idx, 1);
          resolve(m as T);
          return true;
        }
        if (this.closed) {
          reject(new Error(`socket closed (code ${this.closeCode}) while waiting for ${type}`));
          return true;
        }
        if (Date.now() > deadline) {
          reject(new Error(`timeout waiting for ${type}; queued: ${this.queue.map((m) => m.type).join(',')}`));
          return true;
        }
        return false;
      };
      if (check()) return;
      const timer = setInterval(() => {
        if (check()) clearInterval(timer);
      }, 10);
      this.waiters.push(() => {
        if (check()) clearInterval(timer);
      });
    });
  }

  /** Drops all queued messages (e.g. a backlog of snapshots). */
  drain(type?: string): AnyMsg[] {
    const out = type ? this.queue.filter((m) => m.type === type) : this.queue;
    this.queue = type ? this.queue.filter((m) => m.type !== type) : [];
    return out;
  }

  waitClosed(timeoutMs = 3000): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.closed) return resolve();
      const t = setTimeout(() => reject(new Error('socket did not close')), timeoutMs);
      this.waiters.push(() => {
        if (this.closed) {
          clearTimeout(t);
          resolve();
        }
      });
    });
  }

  close(): void {
    this.ws?.close();
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
