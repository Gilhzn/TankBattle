import {
  PROTOCOL_VERSION, TICK_MS,
  type ClientMessage, type Difficulty, type GameMode, type Input, type MatchQueue, type RoomStateMessage, type ServerMessage, type Snapshot, type TickEvent, type VersusFormat,
} from '@tank/shared';
import { Emitter, type GameTransport, type MetaEvent } from './transport.js';
import { getToken } from '../app/api.js';

export type WsState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface GameStartInfo {
  seed: number;
  stage: number;
  snapshot: Snapshot;
  yourSlot: number;
}

/**
 * How often the current input is re-sent when it has not changed. It is a safety net for a dropped
 * packet, and since the local tank is now predicted, a dropped input is a visible correction rather
 * than a moment of nothing happening — so the net is drawn tighter than the 10 ticks it used to be.
 */
const HEARTBEAT_MS = TICK_MS * 5;
const PING_MS = 5000;
const SEAT_KEY = 'irongrid.seat';

interface SavedSeat {
  roomId: string;
  resumeToken: string;
}

/** The room seat survives a page reload (mobile browsers reload tabs freely) so the player can resume. */
function loadSeat(): SavedSeat | null {
  try {
    const raw = sessionStorage.getItem(SEAT_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<SavedSeat>;
    return typeof v.roomId === 'string' && typeof v.resumeToken === 'string' ? { roomId: v.roomId, resumeToken: v.resumeToken } : null;
  } catch {
    return null;
  }
}
function saveSeat(seat: SavedSeat | null): void {
  try {
    if (seat) sessionStorage.setItem(SEAT_KEY, JSON.stringify(seat));
    else sessionStorage.removeItem(SEAT_KEY);
  } catch {
    /* storage unavailable */
  }
}

/**
 * WebSocket client for /ws: hello/welcome, room ops, input + heartbeat, snapshots,
 * reconnect with exponential backoff + jitter and `resume`, RTT pings.
 */
export class WsClient implements GameTransport {
  readonly mode = 'online' as const;
  mySlot = 0;
  rtt = 0;
  paused = false;
  state: WsState = 'idle';
  room: RoomStateMessage | null = null;
  playerId = '';
  name = '';
  lastGameStart: GameStartInfo | null = null;
  attempt = 0;

  private ws: WebSocket | null = null;
  private intentionalClose = false;
  private reconnectTimer = 0;
  private pingTimer = 0;
  private heartbeatTimer = 0;
  private seq = 0;
  private lastInput: Input = { dir: -1, fire: false };
  private lastInputSent = 0;
  private welcomeWaiters: Array<{ resolve: () => void; reject: (e: Error) => void }> = [];
  private itemCountsMap: Record<string, number> = {};
  private nonce = 0;
  private pendingItems = new Map<string, string>();

  readonly snapshots = new Emitter<Snapshot>();
  readonly events = new Emitter<{ events: TickEvent[]; tick: number }>();
  readonly meta = new Emitter<MetaEvent>();
  readonly server = new Emitter<ServerMessage>();
  readonly stateChanged = new Emitter<WsState>();

  private setState(s: WsState): void {
    if (this.state === s) return;
    this.state = s;
    this.stateChanged.emit(s);
  }

  get connected(): boolean {
    return this.state === 'open';
  }

  /** Opens the socket (if needed) and resolves once `welcome` arrives. */
  connect(): Promise<void> {
    if (this.state === 'open') return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      this.welcomeWaiters.push({ resolve, reject });
      if (this.state === 'connecting' || this.state === 'reconnecting') return;
      this.intentionalClose = false;
      this.open();
    });
  }

  private open(): void {
    const token = getToken();
    if (!token) {
      this.failWaiters(new Error('no token'));
      this.setState('closed');
      return;
    }
    this.setState(this.attempt > 0 ? 'reconnecting' : 'connecting');
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    let ws: WebSocket;
    try {
      ws = new WebSocket(`${proto}://${location.host}/ws`);
    } catch (e) {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.send({ type: 'hello', token, version: PROTOCOL_VERSION });
    };
    ws.onmessage = (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMessage;
      } catch {
        return;
      }
      this.handle(msg);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.stopTimers();
      if (this.intentionalClose) {
        this.setState('closed');
        return;
      }
      this.meta.emit({ type: 'connection', state: 'reconnecting', attempt: this.attempt + 1 });
      this.scheduleReconnect();
    };
    ws.onerror = () => {
      /* onclose follows */
    };
  }

  private scheduleReconnect(): void {
    if (this.intentionalClose) return;
    this.attempt++;
    if (this.attempt > 12) {
      this.setState('closed');
      this.failWaiters(new Error('unreachable'));
      this.meta.emit({ type: 'connection', state: 'closed' });
      return;
    }
    this.setState('reconnecting');
    const base = Math.min(10000, 500 * 2 ** (this.attempt - 1));
    const delay = base + Math.random() * 400;
    window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = window.setTimeout(() => this.open(), delay);
  }

  private failWaiters(e: Error): void {
    const w = this.welcomeWaiters;
    this.welcomeWaiters = [];
    for (const x of w) x.reject(e);
  }

  private handle(msg: ServerMessage): void {
    switch (msg.type) {
      case 'welcome': {
        this.playerId = msg.playerId;
        this.name = msg.name;
        const wasReconnect = this.attempt > 0;
        this.attempt = 0;
        this.setState('open');
        this.startTimers();
        const w = this.welcomeWaiters;
        this.welcomeWaiters = [];
        for (const x of w) x.resolve();
        const seat = this.room?.resumeToken ? { roomId: this.room.roomId, resumeToken: this.room.resumeToken } : loadSeat();
        if (seat && (wasReconnect || !this.room)) {
          this.send({ type: 'resume', roomId: seat.roomId, resumeToken: seat.resumeToken });
        }
        this.meta.emit({ type: 'connection', state: 'connected' });
        break;
      }
      case 'roomState': {
        const prevToken = this.room?.resumeToken;
        this.room = { ...msg, resumeToken: msg.resumeToken ?? prevToken };
        const me = msg.players.find((p) => p.id === this.playerId);
        if (me) this.mySlot = me.slot;
        if (this.room.resumeToken) saveSeat({ roomId: this.room.roomId, resumeToken: this.room.resumeToken });
        if (msg.status === 'lobby') this.lastGameStart = null;
        break;
      }
      case 'gameStart': {
        this.mySlot = msg.yourSlot;
        const snap = msg.snapshot as Snapshot;
        this.lastGameStart = { seed: msg.seed, stage: msg.stage, snapshot: snap, yourSlot: msg.yourSlot };
        this.itemCountsMap = this.loadoutCounts();
        this.snapshots.emit(snap);
        if (snap.events?.length) this.events.emit({ events: snap.events, tick: snap.t });
        break;
      }
      case 'snapshot': {
        const snap = msg.snapshot as Snapshot;
        if (!this.lastGameStart && snap.full && this.room && this.room.status !== 'lobby' && this.room.status !== 'gameOver') {
          // resumed into a running match: the server sends roomState + a full snapshot instead of gameStart
          this.lastGameStart = { seed: 0, stage: snap.stage, snapshot: snap, yourSlot: this.mySlot };
          this.itemCountsMap = this.loadoutCounts();
          this.server.emit({ type: 'gameStart', seed: 0, stage: snap.stage, snapshot: snap, yourSlot: this.mySlot });
        }
        this.snapshots.emit(snap);
        if (snap.events?.length) this.events.emit({ events: snap.events, tick: snap.t });
        break;
      }
      case 'itemResult': {
        const sku = this.pendingItems.get(msg.nonce) ?? '';
        this.pendingItems.delete(msg.nonce);
        if (msg.inventory) this.itemCountsMap = { ...this.itemCountsMap, ...msg.inventory };
        else if (msg.ok && sku) this.itemCountsMap[sku] = Math.max(0, (this.itemCountsMap[sku] ?? 1) - 1);
        this.meta.emit({ type: 'itemResult', sku, ok: msg.ok, error: msg.error, inventory: this.itemCountsMap });
        break;
      }
      case 'gameOver':
        this.meta.emit({ type: 'gameOver', reason: msg.reason, results: msg.results });
        break;
      case 'pong':
        this.rtt = Math.max(0, Math.round(performance.now() - msg.t));
        this.meta.emit({ type: 'rtt', ms: this.rtt });
        break;
      case 'error':
        if (msg.code === 'bad_resume' || msg.code === 'room_not_found') saveSeat(null);
        this.meta.emit({ type: 'error', code: msg.code, message: msg.message });
        break;
      case 'left':
      case 'kicked':
        this.room = null;
        this.lastGameStart = null;
        saveSeat(null);
        break;
    }
    this.server.emit(msg);
  }

  private loadoutCounts(): Record<string, number> {
    const me = this.room?.players.find((p) => p.id === this.playerId);
    const out: Record<string, number> = {};
    for (const sku of me?.loadout ?? []) out[sku] = (out[sku] ?? 0) + 1;
    return out;
  }

  private startTimers(): void {
    this.stopTimers();
    this.pingTimer = window.setInterval(() => this.send({ type: 'ping', t: performance.now() }), PING_MS);
    this.heartbeatTimer = window.setInterval(() => {
      if (this.room?.status === 'playing' && performance.now() - this.lastInputSent >= HEARTBEAT_MS - 5) this.pushInput();
    }, HEARTBEAT_MS);
    this.send({ type: 'ping', t: performance.now() });
  }

  private stopTimers(): void {
    window.clearInterval(this.pingTimer);
    window.clearInterval(this.heartbeatTimer);
    this.pingTimer = 0;
    this.heartbeatTimer = 0;
  }

  send(msg: ClientMessage): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  // ---------- room ops ----------
  createRoom(mode: GameMode, isPrivate: boolean, loadout: string[], difficulty: Difficulty = 'normal', versusFormat: VersusFormat = 'ffa'): void {
    this.send({ type: 'createRoom', mode, isPrivate, loadout, difficulty, versusFormat });
  }
  joinRoom(code: string, loadout: string[]): void {
    this.send({ type: 'joinRoom', code: code.toUpperCase(), loadout });
  }
  /**
   * Searches for a match. The server groups players by rating and starts with whoever is there once
   * the search runs out of patience — there is nothing to host and no code to pass around.
   */
  matchQueue(queue: MatchQueue, lang: 'en' | 'he' = 'en', loadout: string[] = []): void {
    this.send({ type: 'matchQueue', queue, lang, loadout });
  }
  matchCancel(): void {
    this.send({ type: 'matchCancel' });
  }
  /** Asks the server to open a private room and tell a friend about it. */
  inviteFriend(friendId: string): void {
    this.send({ type: 'inviteFriend', friendId });
  }
  leaveRoom(): void {
    this.send({ type: 'leaveRoom' });
    this.room = null;
    this.lastGameStart = null;
    saveSeat(null);
  }
  setReady(ready: boolean): void {
    this.send({ type: 'setReady', ready });
  }
  setLoadout(loadout: string[]): void {
    this.send({ type: 'setLoadout', loadout });
  }
  startGame(): void {
    this.send({ type: 'startGame' });
  }
  chat(text: string): void {
    const trimmed = text.trim().slice(0, 140);
    if (trimmed) this.send({ type: 'chat', text: trimmed });
  }

  // ---------- GameTransport ----------
  sendInput(input: Input): void {
    if (input.dir === this.lastInput.dir && input.fire === this.lastInput.fire) return;
    this.lastInput = input;
    this.pushInput();
  }
  private pushInput(): void {
    this.seq++;
    this.lastInputSent = performance.now();
    this.send({ type: 'input', seq: this.seq, dir: this.lastInput.dir, fire: this.lastInput.fire });
  }
  useItem(sku: string): void {
    const nonce = `${Date.now().toString(36)}-${++this.nonce}`;
    this.pendingItems.set(nonce, sku);
    if (!this.send({ type: 'useItem', sku, nonce })) {
      this.pendingItems.delete(nonce);
      this.meta.emit({ type: 'itemResult', sku, ok: false, error: 'offline' });
    }
  }
  itemCounts(): Record<string, number> {
    return this.itemCountsMap;
  }
  onSnapshot(cb: (snap: Snapshot) => void): () => void {
    return this.snapshots.on(cb);
  }
  onEvent(cb: (events: TickEvent[], tick: number) => void): () => void {
    return this.events.on((e) => cb(e.events, e.tick));
  }
  onMeta(cb: (ev: MetaEvent) => void): () => void {
    return this.meta.on(cb);
  }
  pause(): void {
    /* the server never pauses; the local view can hide the field */
  }
  resume(): void {
    /* no-op online */
  }
  /** For the GameTransport contract: the socket outlives a match, so the view only detaches. */
  stop(): void {
    this.lastInput = { dir: -1, fire: false };
  }

  close(): void {
    this.intentionalClose = true;
    window.clearTimeout(this.reconnectTimer);
    this.stopTimers();
    this.ws?.close();
    this.ws = null;
    this.room = null;
    this.lastGameStart = null;
    saveSeat(null);
    this.attempt = 0;
    this.setState('closed');
  }
}

export const ws = new WsClient();
