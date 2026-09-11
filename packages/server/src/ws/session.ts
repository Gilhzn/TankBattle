import { PROTOCOL_VERSION, clientMessageSchema, type ClientMessage, type MatchQueue, type ServerMessage } from '@tank/shared';
import type { WebSocket } from 'ws';
import type { UserRow } from '../db/repo.js';
import type { Room } from '../rooms/room.js';
import { RoomError, type PlayerLink, type RoomUser } from '../rooms/types.js';
import { RateLimiter } from '../util/rateLimit.js';
import type { SessionDeps } from './gateway.js';

export const HELLO_TIMEOUT_MS = 5000;
const MSG_RATE = 60;
const MAX_OVERFLOW = 20;

/** One WebSocket connection. Authenticates via `hello`, then proxies room/game messages. */
export class Session implements PlayerLink {
  user: UserRow | null = null;
  room: Room | null = null;
  alive = true;
  private helloTimer: NodeJS.Timeout | null;
  private limiter: RateLimiter;
  private overflow = 0;
  private closed = false;
  /** The queue this player is searching in, so cancelling can name it back to them. */
  private queuedKind: MatchQueue | null = null;

  constructor(
    private readonly ws: WebSocket,
    readonly ip: string,
    private readonly deps: SessionDeps,
    private readonly onAuth: (s: Session) => void,
    private readonly onClose: (s: Session) => void,
  ) {
    this.limiter = new RateLimiter({ capacity: MSG_RATE, refillPerSec: MSG_RATE }, deps.clock);
    this.helloTimer = setTimeout(() => {
      if (!this.user) this.close(4001, 'hello timeout');
    }, HELLO_TIMEOUT_MS);
    ws.on('message', (data) => this.onRaw(data.toString()));
    ws.on('pong', () => (this.alive = true));
    ws.on('close', () => this.handleClose());
    ws.on('error', () => this.handleClose());
  }

  get userId(): string {
    return this.user?.id ?? '';
  }

  send(msg: ServerMessage): void {
    if (this.ws.readyState === this.ws.OPEN) this.ws.send(JSON.stringify(msg));
  }

  /** The same, for a message the room has already serialised once for everybody. */
  sendRaw(json: string): void {
    if (this.ws.readyState === this.ws.OPEN) this.ws.send(json);
  }

  /** The matchmaker seated this player: adopt the room so their input and chat are accepted. */
  bindRoom(room: Room): void {
    this.room = room;
    this.queuedKind = null;
  }

  error(code: string, message: string): void {
    this.send({ type: 'error', code, message });
  }

  kick(reason: string): void {
    this.send({ type: 'kicked', reason });
    this.close(4002, reason);
  }

  close(code = 1000, reason = ''): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.ws.close(code, reason);
    } catch {
      /* already closed */
    }
    setTimeout(() => this.ws.terminate(), 1000).unref();
  }

  ping(): void {
    if (this.ws.readyState === this.ws.OPEN) this.ws.ping();
  }

  private handleClose(): void {
    if (this.helloTimer) clearTimeout(this.helloTimer);
    this.helloTimer = null;
    this.closed = true;
    this.onClose(this);
  }

  /** Called by the gateway when the same user connects elsewhere or the socket drops. */
  detachFromRoom(): void {
    if (this.user) {
      this.deps.presence.disconnect(this.user.id);
      this.deps.matchmaker.leave(this.user.id);
    }
    if (this.room && this.user) this.room.disconnect(this.user.id);
    this.room = null;
  }

  private onRaw(raw: string): void {
    if (!this.limiter.take(this.ip + ':' + (this.user?.id ?? 'anon'))) {
      if (++this.overflow > MAX_OVERFLOW) this.kick('rate_limit');
      return;
    }
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      this.error('bad_message', 'invalid json');
      return;
    }
    const parsed = clientMessageSchema.safeParse(json);
    if (!parsed.success) {
      this.error('bad_message', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ').slice(0, 200));
      return;
    }
    try {
      this.handle(parsed.data);
    } catch (err) {
      if (err instanceof RoomError) this.error(err.code, err.message);
      else {
        this.deps.log.error('ws handler failed', err);
        this.error('internal', 'internal error');
      }
    }
  }

  private roomUser(): RoomUser {
    const u = this.user!;
    return { id: u.id, name: u.nickname, skin: u.skin };
  }

  private requireRoom(): Room {
    if (!this.room) throw new RoomError('not_in_room', 'join a room first');
    return this.room;
  }

  private leaveCurrent(): void {
    if (this.room && this.user) this.room.leave(this.user.id);
    this.room = null;
  }

  private handle(msg: ClientMessage): void {
    if (!this.user) {
      if (msg.type !== 'hello') {
        this.error('not_authenticated', 'send hello first');
        return;
      }
      this.hello(msg.token, msg.version);
      return;
    }
    const user = this.user;
    switch (msg.type) {
      case 'hello':
        this.error('already_authenticated', 'hello already received');
        return;
      case 'ping':
        this.send({ type: 'pong', t: msg.t, serverTick: this.room?.runner?.tick ?? 0, serverTime: this.deps.clock() });
        return;
      case 'createRoom':
        this.leaveCurrent();
        this.room = this.deps.rooms.create(this.roomUser(), this, msg.mode, msg.isPrivate, msg.loadout, false, msg.difficulty, msg.versusFormat);
        return;
      case 'joinRoom':
        this.leaveCurrent();
        this.room = this.deps.rooms.join(this.roomUser(), this, msg.code, msg.loadout);
        return;
      case 'resume': {
        const room = this.deps.rooms.get(msg.roomId);
        if (!room) throw new RoomError('room_not_found', 'room no longer exists');
        if (this.room && this.room !== room) this.leaveCurrent();
        room.resume(user.id, msg.resumeToken, this);
        this.room = room;
        return;
      }
      case 'leaveRoom':
        this.leaveCurrent();
        this.deps.matchmaker.leave(user.id);
        this.send({ type: 'left' });
        return;
      case 'matchQueue': {
        this.leaveCurrent();
        this.deps.matchmaker.enqueue({
          user: this.roomUser(),
          link: this,
          rating: this.deps.ranking.rating(user.id),
          country: user.country,
          lang: msg.lang,
          queue: msg.queue,
          loadout: msg.loadout,
          queuedAt: this.deps.clock(),
          // Overwritten by the matchmaker, which owns how long this search waits.
          fillAt: 0,
        });
        this.queuedKind = msg.queue;
        return;
      }
      case 'matchCancel': {
        const queue = this.queuedKind ?? '1v1';
        this.deps.matchmaker.leave(user.id);
        this.queuedKind = null;
        this.send({ type: 'queued', queue, searching: false, since: this.deps.clock(), found: 0, needed: 0 });
        return;
      }
      case 'inviteFriend':
        this.inviteFriend(user, msg.friendId);
        return;
      case 'setReady':
        this.requireRoom().setReady(user.id, msg.ready);
        return;
      case 'setLoadout':
        this.requireRoom().setLoadout(user.id, msg.loadout);
        return;
      case 'chat':
        this.requireRoom().chat(user.id, msg.text);
        return;
      case 'startGame':
        this.requireRoom().start(user.id);
        return;
      case 'input': {
        const room = this.requireRoom();
        const p = room.player(user.id);
        if (room.runner && p) room.runner.onInput(p.slot, msg.seq, msg.dir, msg.fire);
        return;
      }
      case 'useItem': {
        const room = this.requireRoom();
        const p = room.player(user.id);
        if (!room.runner || !p) this.send({ type: 'itemResult', nonce: msg.nonce, ok: false, error: 'not_playing' });
        else this.send(room.runner.useItem(p, msg.sku, msg.nonce));
        return;
      }
    }
  }

  /**
   * Opens a private room and tells a friend where it is. This is the one way to play with a
   * specific person: no code is read out or typed in — the invitation carries it.
   */
  private inviteFriend(user: UserRow, friendId: string): void {
    if (friendId === user.id) throw new RoomError('self_invite', 'you cannot invite yourself');
    if (!this.deps.db.friends.has(user.id, friendId)) throw new RoomError('not_friends', 'not on your friends list');
    // Reuse the room already open, so inviting a second friend does not strand the first.
    const room = this.room?.isPrivate && this.room.joinable && this.room.player(user.id) ? this.room : this.openInviteRoom(user);
    if (!this.deps.sendTo(friendId, { type: 'gameInvite', fromId: user.id, fromName: user.nickname, code: room.code })) {
      throw new RoomError('friend_offline', 'they are not online right now');
    }
  }

  private openInviteRoom(user: UserRow): Room {
    this.leaveCurrent();
    this.deps.matchmaker.leave(user.id);
    const room = this.deps.rooms.create(this.roomUser(), this, 'versus', true, []);
    this.room = room;
    return room;
  }

  private hello(token: string, version: number): void {
    if (version !== PROTOCOL_VERSION) {
      this.error('bad_version', `protocol version ${PROTOCOL_VERSION} required`);
      this.close(4003, 'bad version');
      return;
    }
    const user = this.deps.authenticate(token);
    if (!user) {
      this.error('unauthorized', 'invalid token');
      this.close(4001, 'unauthorized');
      return;
    }
    if (this.helloTimer) clearTimeout(this.helloTimer);
    this.helloTimer = null;
    this.user = user;
    this.deps.presence.connect(user.id);
    this.onAuth(this);
    this.send({ type: 'welcome', playerId: user.id, name: user.nickname, serverTime: this.deps.clock(), tickRate: this.deps.tickRate, snapshotRate: this.deps.snapshotRate });
  }
}
