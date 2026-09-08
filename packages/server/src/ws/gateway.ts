import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import type { Db, UserRow } from '../db/repo.js';
import type { RoomManager } from '../rooms/roomManager.js';
import type { Matchmaker } from '../rooms/matchmaker.js';
import type { RankingService } from '../social/ranking.js';
import type { Presence } from '../social/presence.js';
import type { ServerMessage } from '@tank/shared';
import type { Logger } from '../util/log.js';
import type { Clock } from '../util/time.js';
import { Session } from './session.js';

export interface GatewayDeps {
  clock: Clock;
  db: Db;
  log: Logger;
  rooms: RoomManager;
  matchmaker: Matchmaker;
  ranking: RankingService;
  presence: Presence;
  tickRate: number;
  snapshotRate: number;
  /** Token → user (null when invalid). */
  authenticate(token: string): UserRow | null;
  heartbeatMs?: number;
}

/** What a session sees: the gateway's own deps plus the ability to reach another player. */
export interface SessionDeps extends GatewayDeps {
  /** Sends to a user's live session. False when they are not connected. */
  sendTo(userId: string, msg: ServerMessage): boolean;
}

/** Accepts `/ws` upgrades, tracks one live session per user and heartbeats sockets. */
export class Gateway {
  private wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  private sessions = new Map<string, Session>();
  private all = new Set<Session>();
  private heartbeat: NodeJS.Timeout;

  constructor(server: Server, gatewayDeps: GatewayDeps) {
    const deps: SessionDeps = { ...gatewayDeps, sendTo: (userId, msg) => this.sendToUser(userId, msg) };
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

  /** Pushes a message to whoever is logged in as `userId` right now. */
  sendToUser(userId: string, msg: ServerMessage): boolean {
    const s = this.sessions.get(userId);
    if (!s) return false;
    s.send(msg);
    return true;
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
