import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import type { UserRow } from '../db/repo.js';
import type { RoomManager } from '../rooms/roomManager.js';
import type { Logger } from '../util/log.js';
import type { Clock } from '../util/time.js';
import { Session } from './session.js';

export interface GatewayDeps {
  clock: Clock;
  log: Logger;
  rooms: RoomManager;
  tickRate: number;
  snapshotRate: number;
  /** Token → user (null when invalid). */
  authenticate(token: string): UserRow | null;
  heartbeatMs?: number;
}

/** Accepts `/ws` upgrades, tracks one live session per user and heartbeats sockets. */
export class Gateway {
  private wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  private sessions = new Map<string, Session>();
  private all = new Set<Session>();
  private heartbeat: NodeJS.Timeout;

  constructor(server: Server, deps: GatewayDeps) {
    server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname !== '/ws') {
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => {
        const ip = (req.headers['x-forwarded-for']?.toString().split(',')[0] ?? req.socket.remoteAddress ?? 'unknown').trim();
        const session = new Session(ws, ip, deps, (s) => this.onAuth(s), (s) => this.onClose(s));
        this.all.add(session);
      });
    });
    this.heartbeat = setInterval(() => this.pingAll(), deps.heartbeatMs ?? 15_000);
    this.heartbeat.unref();
  }

  get connections(): number {
    return this.all.size;
  }

  private onAuth(s: Session): void {
    const old = this.sessions.get(s.userId);
    if (old && old !== s) {
      old.detachFromRoom();
      old.kick('replaced');
      this.all.delete(old);
    }
    this.sessions.set(s.userId, s);
  }

  private onClose(s: Session): void {
    this.all.delete(s);
    if (s.userId && this.sessions.get(s.userId) === s) this.sessions.delete(s.userId);
    s.detachFromRoom();
  }

  private pingAll(): void {
    for (const s of this.all) {
      if (!s.alive) {
        s.close(4004, 'heartbeat timeout');
        continue;
      }
      s.alive = false;
      s.ping();
    }
  }

  close(): Promise<void> {
    clearInterval(this.heartbeat);
    for (const s of this.all) s.close(1001, 'server shutdown');
    return new Promise((resolve) => this.wss.close(() => resolve()));
  }
}
