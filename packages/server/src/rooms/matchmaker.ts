import { arenaIndexForRating, STARTING_RATING, type VersusFormat } from '@tank/shared';
import { skillForRating, VersusBot } from '../game/bot.js';
import { botName, regionFor } from '../game/botNames.js';
import type { ChatResponder } from '../game/botChat.js';
import type { Room } from './room.js';
import type { RoomManager } from './roomManager.js';
import type { PlayerLink, RoomUser } from './types.js';
import type { Logger } from '../util/log.js';
import type { Clock } from '../util/time.js';
import { newId } from '../util/ids.js';

/** How far apart two ratings may be at the start of a search. */
const START_WINDOW = 60;
/** How much the window widens per second of waiting. */
const WIDEN_PER_SEC = 45;
/** Beyond this the search is effectively "anyone", so waiting longer buys nothing. */
const MAX_WINDOW = 800;

export interface Ticket {
  user: RoomUser;
  link: PlayerLink;
  rating: number;
  country: string;
  lang: 'en' | 'he';
  format: VersusFormat;
  loadout: string[];
  queuedAt: number;
}

export interface MatchmakerDeps {
  rooms: RoomManager;
  clock: Clock;
  log: Logger;
  /** Wait before the game fills the match itself. */
  botTimeoutMs: number;
  /** Chat voice given to bots. */
  chatResponder: ChatResponder;
  /** Called when a ticket is matched, so the session can bind to the room. */
  onMatched(ticket: Ticket, room: Room): void;
}

/**
 * Ranked matchmaking.
 *
 * Players queue with their rating and are paired with the closest opponent inside a window that
 * widens the longer they wait, so a strong player is not held forever waiting for their exact peer.
 * If nobody suitable turns up within the configured wait, the game fills the seat itself rather
 * than leaving someone staring at a spinner.
 */
export class Matchmaker {
  private queue: Ticket[] = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly deps: MatchmakerDeps) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.pump(), 500);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.queue = [];
  }

  get size(): number {
    return this.queue.length;
  }

  /** Adds a player to the ranked queue, replacing any ticket they already had. */
  enqueue(ticket: Ticket): void {
    this.leave(ticket.user.id);
    this.queue.push(ticket);
    this.start();
    // Try straight away: two players arriving together should not wait for the next sweep.
    this.pump();
  }

  leave(userId: string): boolean {
    const before = this.queue.length;
    this.queue = this.queue.filter((t) => t.user.id !== userId);
    return this.queue.length !== before;
  }

  /** How wide `ticket`'s search has grown. */
  private window(ticket: Ticket, now: number): number {
    const waitedSec = Math.max(0, (now - ticket.queuedAt) / 1000);
    return Math.min(MAX_WINDOW, START_WINDOW + waitedSec * WIDEN_PER_SEC);
  }

  /** The best opponent for `ticket` right now: the closest rating that is inside both windows. */
  private bestOpponent(ticket: Ticket, now: number): Ticket | null {
    let best: Ticket | null = null;
    let bestGap = Infinity;
    for (const other of this.queue) {
      if (other === ticket || other.user.id === ticket.user.id) continue;
      if (other.format !== ticket.format) continue;
      const gap = Math.abs(other.rating - ticket.rating);
      // Both players have to be willing to accept the gap, or the one who just queued would be
      // dragged into a mismatch by someone who has been waiting a long time.
      if (gap > this.window(ticket, now) || gap > this.window(other, now)) continue;
      if (gap < bestGap) {
        bestGap = gap;
        best = other;
      }
    }
    return best;
  }

  private pump(): void {
    const now = this.deps.clock();
    // Longest-waiting first, so nobody is starved by a steady stream of new arrivals.
    for (const ticket of [...this.queue].sort((a, b) => a.queuedAt - b.queuedAt)) {
      if (!this.queue.includes(ticket)) continue;
      const opponent = this.bestOpponent(ticket, now);
      if (opponent) {
        this.pair(ticket, opponent);
        continue;
      }
      if (now - ticket.queuedAt >= this.deps.botTimeoutMs) this.fillWithBot(ticket);
    }
  }

  /** Opens a room for two queued players. */
  private pair(a: Ticket, b: Ticket): void {
    this.queue = this.queue.filter((t) => t !== a && t !== b);
    // The arena comes from the pair's average rating, so both see a map that fits their level.
    const stage = arenaIndexForRating(Math.round((a.rating + b.rating) / 2));
    const room = this.deps.rooms.create(a.user, a.link, 'versus', true, a.loadout, true, 'normal', a.format, stage);
    room.join(b.user, b.link, b.loadout);
    this.deps.onMatched(a, room);
    this.deps.onMatched(b, room);
    this.deps.log.debug(`ranked: ${a.user.name} (${a.rating}) vs ${b.user.name} (${b.rating})`);
    room.start();
  }

  /**
   * Fills the other seat itself. The opponent is rated close to the human (a little either way, so
   * the ladder still moves) and plays at that level; nothing on the wire distinguishes it from a
   * person, which is the point — the alternative is telling someone there is nobody to play.
   */
  private fillWithBot(ticket: Ticket): void {
    this.queue = this.queue.filter((t) => t !== ticket);
    const stage = arenaIndexForRating(ticket.rating);
    const room = this.deps.rooms.create(ticket.user, ticket.link, 'versus', true, ticket.loadout, true, 'normal', ticket.format, stage);

    // A believable opponent is near the player, not identical to them.
    const spread = 40;
    const rating = Math.max(100, Math.round(ticket.rating + (Math.random() * 2 - 1) * spread));
    const taken = new Set(room.players.map((p) => p.name));
    room.addBot({
      id: `bot:${newId()}`,
      name: botName(regionFor(ticket.country), taken),
      skin: 'default',
      bot: { controller: new VersusBot(1, skillForRating(rating)), rating, chat: this.deps.chatResponder, lang: ticket.lang },
    });
    this.deps.onMatched(ticket, room);
    this.deps.log.debug(`ranked: ${ticket.user.name} (${ticket.rating}) filled after ${this.deps.botTimeoutMs}ms`);
    room.start();
  }

  /** The rating a seat plays at, for the result: a bot's is its assigned one. */
  static seatRating(room: Room, userId: string, fallback = STARTING_RATING): number {
    const p = room.players.find((x) => x.id === userId);
    return p?.bot?.rating ?? fallback;
  }
}
