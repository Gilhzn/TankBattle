import type { Difficulty } from '@tank/shared';
import { MAX_PLAYERS, teamOf, type RoomPlayerInfo, type RoomStateMessage, type RoomStatus, type ServerMessage, type VersusFormat } from '@tank/shared';
import { VersusBot } from '../game/bot.js';
import { typingDelayMs, type ChatResponder } from '../game/botChat.js';
import type { GameRunner } from '../game/runner.js';
import { newNonce } from '../util/ids.js';
import type { Logger } from '../util/log.js';
import type { Clock } from '../util/time.js';
import { RoomError, type PlayerLink, type RoomUser } from './types.js';

export const DISCONNECT_GRACE_MS = 30_000;
export const EMPTY_ROOM_TTL_MS = 60_000;

export interface RoomPlayer {
  id: string;
  name: string;
  skin: string;
  slot: number;
  ready: boolean;
  connected: boolean;
  loadout: string[];
  resumeToken: string;
  link: PlayerLink | null;
  disconnectTimer: NodeJS.Timeout | null;
  /**
   * Set when this seat is filled by the game rather than a person. It occupies an ordinary seat and
   * is reported like any other player, so the wire format cannot be used to tell them apart.
   */
  bot?: BotSeat;
}

/** A seat the game plays itself: the controller that drives it and the chat voice behind it. */
export interface BotSeat {
  controller: VersusBot;
  rating: number;
  chat: ChatResponder;
  lang: 'en' | 'he';
}

export interface RoomDeps {
  clock: Clock;
  log: Logger;
  countdownMs: number;
  disconnectGraceMs?: number;
  emptyTtlMs?: number;
  createRunner(room: Room): GameRunner;
  /** Called once the room has been empty for the TTL (or is destroyed). */
  onEmpty(room: Room): void;
}

/** A lobby + (optionally) a running match. All mutations broadcast `roomState`. */
export class Room {
  status: RoomStatus = 'lobby';
  hostId = '';
  players: RoomPlayer[] = [];
  runner: GameRunner | null = null;
  countdownEndsAt: number | undefined;
  /** When the lobby gained its 2nd player (quick-play auto-start timer). */
  pairedSince: number | null = null;
  readonly createdAt: number;
  private countdownTimer: NodeJS.Timeout | null = null;
  /** What each bot has already said, so it does not repeat a line within one match. */
  private chatHistory = new Map<string, string[]>();
  private botChatTimers = new Set<NodeJS.Timeout>();
  private emptyTimer: NodeJS.Timeout | null = null;
  private destroyed = false;

  constructor(
    readonly id: string,
    readonly code: string,
    readonly mode: 'coop' | 'versus',
    readonly difficulty: Difficulty,
    readonly versusFormat: VersusFormat,
    readonly isPrivate: boolean,
    readonly quickPlay: boolean,
    /** Versus arena index, from the players' rating band. Ignored in co-op, which starts at stage 1. */
    readonly stage: number,
    private readonly deps: RoomDeps,
  ) {
    this.createdAt = deps.clock();
    this.armEmptyTimer();
  }

  get size(): number {
    return this.players.length;
  }
  get isFull(): boolean {
    return this.players.length >= this.capacity;
  }

  /** 2v2 needs exactly four seats; every other format fills up to the cap. */
  get capacity(): number {
    return MAX_PLAYERS;
  }
  get joinable(): boolean {
    return !this.destroyed && this.status === 'lobby' && !this.isFull;
  }

  player(userId: string): RoomPlayer | undefined {
    return this.players.find((p) => p.id === userId);
  }

  /** True when a person is sitting in this seat. */
  get humanPlayers(): RoomPlayer[] {
    return this.players.filter((p) => !p.bot);
  }

  /**
   * Seats a bot. It takes a normal slot with a normal id, so every path that walks `players` —
   * seat compaction, snapshots, room state — treats it exactly like a person.
   */
  addBot(seat: { id: string; name: string; skin: string; bot: BotSeat }): RoomPlayer {
    const used = new Set(this.players.map((p) => p.slot));
    let slot = 0;
    while (used.has(slot)) slot++;
    const p: RoomPlayer = {
      id: seat.id, name: seat.name, skin: seat.skin, slot, ready: true, connected: true,
      loadout: [], resumeToken: newNonce(18), link: null, disconnectTimer: null, bot: seat.bot,
    };
    p.bot!.controller = new VersusBot(slot, p.bot!.controller.skill);
    this.players.push(p);
    this.players.sort((a, b) => a.slot - b.slot);
    this.clearEmptyTimer();
    this.broadcastState();
    return p;
  }

  /** Lobby-only join. Throws RoomError('room_full' | 'in_progress'). */
  join(user: RoomUser, link: PlayerLink, loadout: string[]): RoomPlayer {
    if (this.destroyed) throw new RoomError('room_closed', 'room no longer exists');
    const existing = this.player(user.id);
    if (existing) {
      this.attach(existing, link);
      this.broadcastState();
      return existing;
    }
    if (this.status !== 'lobby') throw new RoomError('in_progress', 'game already in progress');
    if (this.isFull) throw new RoomError('room_full', 'room is full');
    const used = new Set(this.players.map((p) => p.slot));
    let slot = 0;
    while (used.has(slot)) slot++;
    const p: RoomPlayer = { id: user.id, name: user.name, skin: user.skin, slot, ready: false, connected: true, loadout: [...loadout], resumeToken: newNonce(18), link, disconnectTimer: null };
    this.players.push(p);
    this.players.sort((a, b) => a.slot - b.slot);
    if (!this.hostId) this.hostId = p.id;
    if (this.players.length >= 2 && this.pairedSince === null) this.pairedSince = this.deps.clock();
    this.clearEmptyTimer();
    this.broadcastState();
    return p;
  }

  /** Removes a player (mid-game too). Transfers host; schedules deletion when empty. */
  leave(userId: string): boolean {
    const p = this.player(userId);
    if (!p) return false;
    if (p.disconnectTimer) clearTimeout(p.disconnectTimer);
    this.players = this.players.filter((x) => x !== p);
    if (this.runner) this.runner.removePlayer(p.slot);
    if (this.hostId === p.id) this.hostId = this.players[0]?.id ?? '';
    if (this.players.length < 2) this.pairedSince = null;
    // A room with only bots left in it is empty: there is nobody for them to play against.
    if (this.humanPlayers.length === 0) {
      this.players = [];
      this.cancelCountdown();
      if (this.runner) {
        this.runner.stop();
        this.runner = null;
        this.status = 'lobby';
      }
      this.armEmptyTimer();
    }
    this.broadcastState();
    return true;
  }

  /** Keeps the seat for a grace period; the runner stops reading the player's input meanwhile. */
  disconnect(userId: string): void {
    const p = this.player(userId);
    if (!p) return;
    p.connected = false;
    p.link = null;
    this.runner?.clearInput(p.slot);
    if (p.disconnectTimer) clearTimeout(p.disconnectTimer);
    p.disconnectTimer = setTimeout(() => {
      p.disconnectTimer = null;
      this.leave(p.id);
    }, this.deps.disconnectGraceMs ?? DISCONNECT_GRACE_MS);
    this.broadcastState();
  }

  /** Re-attaches a returning player when the resume token matches. */
  resume(userId: string, resumeToken: string, link: PlayerLink): RoomPlayer {
    const p = this.player(userId);
    if (!p || p.resumeToken !== resumeToken) throw new RoomError('bad_resume', 'cannot resume: unknown player or token');
    this.attach(p, link);
    this.broadcastState();
    if (this.runner) this.runner.sendFull(p);
    return p;
  }

  private attach(p: RoomPlayer, link: PlayerLink): void {
    if (p.disconnectTimer) clearTimeout(p.disconnectTimer);
    p.disconnectTimer = null;
    p.link = link;
    p.connected = true;
  }

  setReady(userId: string, ready: boolean): void {
    const p = this.player(userId);
    if (!p) return;
    p.ready = ready;
    this.broadcastState();
    this.maybeAutoStart();
  }

  setLoadout(userId: string, loadout: string[]): void {
    const p = this.player(userId);
    if (!p || this.status !== 'lobby') return;
    p.loadout = [...loadout];
    this.broadcastState();
  }

  chat(userId: string, text: string): void {
    const p = this.player(userId);
    if (!p) return;
    this.broadcast({ type: 'chat', from: p.id, name: p.name, text });
    for (const other of this.players) if (other.bot) void this.botReply(other, p, text);
  }

  /**
   * A bot answering a message. The reply is delayed by how long it would have taken to type — an
   * instant answer is the loudest tell there is — and is dropped if the match ends meanwhile.
   */
  private async botReply(bot: RoomPlayer, from: RoomPlayer, text: string): Promise<void> {
    const seat = bot.bot;
    if (!seat) return;
    const history = this.chatHistory.get(bot.id) ?? [];
    const mine = this.runner?.state.players[bot.slot];
    const theirs = this.runner?.state.players[from.slot];
    const standing = !mine || !theirs ? 0 : mine.kills > theirs.kills ? 1 : mine.kills < theirs.kills ? -1 : 0;
    let reply: string | null = null;
    try {
      reply = await seat.chat.reply({
        text, opponentName: from.name, selfName: bot.name, lang: seat.lang, standing: standing as -1 | 0 | 1, history,
      });
    } catch (err) {
      this.deps.log.debug('bot chat failed', err);
      return;
    }
    if (!reply || this.destroyed) return;
    history.push(reply);
    this.chatHistory.set(bot.id, history.slice(-8));
    const delay = typingDelayMs(reply);
    const timer = setTimeout(() => {
      this.botChatTimers.delete(timer);
      if (this.destroyed || !this.player(bot.id)) return;
      this.broadcast({ type: 'chat', from: bot.id, name: bot.name, text: reply });
    }, delay);
    timer.unref?.();
    this.botChatTimers.add(timer);
  }

  /** Host-initiated (or automatic) start: countdown then `gameStart`. */
  start(byUserId?: string): void {
    if (this.status !== 'lobby') throw new RoomError('not_in_lobby', 'game already started');
    if (byUserId !== undefined && byUserId !== this.hostId) throw new RoomError('not_host', 'only the host can start');
    if (this.players.length === 0) throw new RoomError('empty_room');
    this.status = 'countdown';
    this.countdownEndsAt = this.deps.clock() + this.deps.countdownMs;
    this.countdownTimer = setTimeout(() => {
      this.countdownTimer = null;
      this.begin();
    }, this.deps.countdownMs);
    this.broadcastState();
  }

  /** Quick-play lobbies start on their own: 4 players, everyone ready, or 2+ players for a while. */
  maybeAutoStart(now = this.deps.clock(), waitMs = 10_000): void {
    if (!this.quickPlay || this.status !== 'lobby' || this.players.length === 0) return;
    const connected = this.players.filter((p) => p.connected);
    if (connected.length < 2) return;
    const allReady = connected.every((p) => p.ready);
    const waited = this.pairedSince !== null && now - this.pairedSince >= waitMs;
    if (this.isFull || allReady || waited) this.start();
  }

  private begin(): void {
    if (this.destroyed || this.players.length === 0) return;
    // Compact seats so slot i === state.players[i].
    this.players.sort((a, b) => a.slot - b.slot).forEach((p, i) => (p.slot = i));
    this.status = 'playing';
    this.countdownEndsAt = undefined;
    this.broadcastState();
    try {
      this.runner = this.deps.createRunner(this);
      this.runner.start();
    } catch (err) {
      this.deps.log.error(`room ${this.code}: failed to start game`, err);
      this.runner = null;
      this.status = 'lobby';
      this.broadcastState();
    }
  }

  /** The runner calls this after it has delivered `gameOver` + `walletUpdate`. */
  onGameOver(): void {
    this.runner = null;
    this.status = 'lobby';
    this.pairedSince = this.players.length >= 2 ? this.deps.clock() : null;
    for (const p of this.players) p.ready = false;
    this.broadcastState();
  }

  stateFor(playerId: string | null): RoomStateMessage {
    const players: RoomPlayerInfo[] = this.players.map((p) => ({
      id: p.id, name: p.name, slot: p.slot, ready: p.ready, connected: p.connected, loadout: [...p.loadout], skin: p.skin, isHost: p.id === this.hostId,
      team: teamOf(p.slot, this.mode, this.versusFormat),
    }));
    const msg: RoomStateMessage = {
      type: 'roomState', roomId: this.id, code: this.code, mode: this.mode, versusFormat: this.versusFormat,
      isPrivate: this.isPrivate, status: this.status, hostId: this.hostId, players,
    };
    if (this.countdownEndsAt !== undefined) msg.countdownEndsAt = this.countdownEndsAt;
    const me = playerId ? this.player(playerId) : undefined;
    if (me) msg.resumeToken = me.resumeToken;
    return msg;
  }

  broadcastState(): void {
    for (const p of this.players) p.link?.send(this.stateFor(p.id));
  }

  /**
   * One message to every seat. It is serialised once here rather than once inside each connection:
   * a four-player match broadcasts the same snapshot thirty times a second, and doing that work per
   * player is four times the JSON for no reason. A link that cannot take a pre-encoded string (the
   * test sinks) still gets the object.
   */
  broadcast(msg: ServerMessage, except?: string): void {
    let json: string | null = null;
    for (const p of this.players) {
      if (p.id === except || !p.link) continue;
      if (!p.link.sendRaw) {
        p.link.send(msg);
        continue;
      }
      json ??= JSON.stringify(msg);
      p.link.sendRaw(json);
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cancelCountdown();
    this.clearEmptyTimer();
    this.runner?.stop();
    this.runner = null;
    for (const p of this.players) if (p.disconnectTimer) clearTimeout(p.disconnectTimer);
    for (const t of this.botChatTimers) clearTimeout(t);
    this.botChatTimers.clear();
    this.chatHistory.clear();
    this.players = [];
  }

  private cancelCountdown(): void {
    if (this.countdownTimer) clearTimeout(this.countdownTimer);
    this.countdownTimer = null;
    this.countdownEndsAt = undefined;
    if (this.status === 'countdown') this.status = 'lobby';
  }

  private armEmptyTimer(): void {
    this.clearEmptyTimer();
    this.emptyTimer = setTimeout(() => {
      this.emptyTimer = null;
      if (this.players.length === 0) this.deps.onEmpty(this);
    }, this.deps.emptyTtlMs ?? EMPTY_ROOM_TTL_MS);
    this.emptyTimer.unref();
  }

  private clearEmptyTimer(): void {
    if (this.emptyTimer) clearTimeout(this.emptyTimer);
    this.emptyTimer = null;
  }
}
