import { arenaIndexForRating, MATCH_QUEUES, STARTING_RATING, type MatchQueue } from '@tank/shared';
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
  queue: MatchQueue;
  loadout: string[];
  queuedAt: number;
  /**
   * When this search gives up on finding more humans. Drawn once per ticket, so two players who
   * queue seconds apart wait different lengths and the fill never lands on a predictable beat.
   */
  fillAt: number;
}

export interface MatchmakerDeps {
  rooms: RoomManager;
  clock: Clock;
  log: Logger;
  /**
   * How long this search should wait for a full match before starting with whoever is there.
   * Called once per ticket. A function rather than a number so tests can pin it.
   */
  fillAfterMs(): number;
  /** Chat voice given to bots. */
  chatResponder: ChatResponder;
  /** Called when a ticket is matched, so the session can bind to the room. */
  onMatched(ticket: Ticket, room: Room): void;
}

/**
 * Matchmaking: the only way into a public game.
 *
 * A player picks a queue — 1v1, 2v2, deathmatch or co-op — and is grouped with the closest-rated
 * players searching for the same thing, inside a window that widens the longer they wait. Each
 * ticket carries its own deadline; once one is reached the match starts with whoever is present,
 * and only the seats still missing below the queue's minimum are filled by the game.
 *
 * The deadline is never sent to the player. A visible countdown announces that nobody is coming,
 * which is exactly the thing a search should not say out loud.
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

  /** How many players are searching for one kind of match. */
  waiting(kind: MatchQueue): number {
    return this.queue.filter((t) => t.queue === kind).length;
  }

  /** Adds a player to the queue, replacing any ticket they already had. */
  enqueue(ticket: Ticket): void {
    const previous = this.leaveTicket(ticket.user.id);
    ticket.fillAt = ticket.queuedAt + this.deps.fillAfterMs();
    this.queue.push(ticket);
    this.start();
    // Try straight away: players arriving together should not wait for the next sweep.
    this.pump();
    // The pump may already have taken this ticket into a match; only tell the ones still waiting.
    this.notify(ticket.queue);
    if (previous && previous.queue !== ticket.queue) this.notify(previous.queue);
  }

  leave(userId: string): boolean {
    const gone = this.leaveTicket(userId);
    if (gone) this.notify(gone.queue);
    return !!gone;
  }

  private leaveTicket(userId: string): Ticket | null {
    const found = this.queue.find((t) => t.user.id === userId) ?? null;
    if (found) this.queue = this.queue.filter((t) => t !== found);
    return found;
  }

  /** How wide `ticket`'s search has grown. */
  private window(ticket: Ticket, now: number): number {
    const waitedSec = Math.max(0, (now - ticket.queuedAt) / 1000);
    return Math.min(MAX_WINDOW, START_WINDOW + waitedSec * WIDEN_PER_SEC);
  }

  /**
   * The best group for one queue right now: the closest-rated run of `size` players where every
   * member accepts the spread. Requiring *mutual* consent is what stops someone who has waited a
   * long time from dragging a player who just queued into a mismatch.
   */
  private tryForm(kind: MatchQueue, now: number): Ticket[] | null {
    const need = MATCH_QUEUES[kind].size;
    const list = this.queue.filter((t) => t.queue === kind).sort((a, b) => a.rating - b.rating);
    if (list.length < need) return null;
    let best: Ticket[] | null = null;
    let bestWait = -1;
    for (let i = 0; i + need <= list.length; i++) {
      const group = list.slice(i, i + need);
      const spread = group[need - 1].rating - group[0].rating;
      if (group.some((t) => spread > this.window(t, now))) continue;
      // Longest-waiting group first, so nobody is starved by a steady stream of new arrivals.
      const wait = now - Math.min(...group.map((t) => t.queuedAt));
      if (wait > bestWait) {
        bestWait = wait;
        best = group;
      }
    }
    return best;
  }

  private pump(): void {
    const now = this.deps.clock();
    for (const kind of Object.keys(MATCH_QUEUES) as MatchQueue[]) {
      let formed = false;
      for (;;) {
        const group = this.tryForm(kind, now);
        if (!group) break;
        this.form(group, kind);
        formed = true;
      }
      // Once any one search has waited out its own deadline, start with whoever is present.
      // Longest waiters first, and never more than the match has seats for — the rest keep
      // searching. Taking the oldest tickets rather than only the expired one keeps the group fair
      // when a newcomer happens to have drawn the shorter wait.
      const waiting = this.queue.filter((t) => t.queue === kind).sort((a, b) => a.queuedAt - b.queuedAt);
      if (waiting.some((t) => now >= t.fillAt)) {
        this.form(waiting.slice(0, MATCH_QUEUES[kind].size), kind);
        formed = true;
      }
      if (formed) this.notify(kind);
    }
  }

  /**
   * Opens a room for a group. A group short of the queue's minimum is topped up by the game, so a
   * player who searched alone still gets a match rather than a spinner.
   */
  private form(group: Ticket[], kind: MatchQueue): void {
    const def = MATCH_QUEUES[kind];
    const taking = new Set(group);
    this.queue = this.queue.filter((t) => !taking.has(t));

    const seated = this.seatOrder(group, kind);
    const first = seated[0];
    const mean = Math.round(group.reduce((sum, t) => sum + t.rating, 0) / group.length);
    // The arena comes from the group's rating, so everyone sees a map that fits their level.
    const stage = def.mode === 'versus' ? arenaIndexForRating(mean) : 0;
    const room = this.deps.rooms.create(first.user, first.link, def.mode, true, first.loadout, true, 'normal', def.versusFormat, stage);
    for (const t of seated.slice(1)) room.join(t.user, t.link, t.loadout);
    for (const t of seated) this.deps.onMatched(t, room);

    const missing = Math.max(0, def.min - group.length);
    for (let i = 0; i < missing; i++) this.addBot(room, mean, first.country, first.lang);

    this.deps.log.debug(`match ${kind}: ${seated.map((t) => `${t.user.name}(${t.rating})`).join(', ')}${missing ? ` +${missing}` : ''}`);
    room.start();
  }

  /**
   * The order seats are taken in, which is what decides the teams: `teamOf` is `slot % 2`, so slots
   * 0/2 play slots 1/3. Pairing the weakest with the strongest against the two in the middle is the
   * closest two teams can be made from four given ratings.
   */
  private seatOrder(group: Ticket[], kind: MatchQueue): Ticket[] {
    if (kind !== '2v2' || group.length !== 4) return group;
    const [a, b, c, d] = [...group].sort((x, y) => x.rating - y.rating);
    return [a, b, d, c];
  }

  /**
   * Fills a seat itself. The opponent is rated close to the humans (a little either way, so the
   * ladder still moves) and plays at that level; nothing on the wire distinguishes it from a
   * person, which is the point — the alternative is telling someone there is nobody to play.
   */
  private addBot(room: Room, mean: number, country: string, lang: 'en' | 'he'): void {
    // A believable opponent is near the player, not identical to them.
    const spread = 40;
    const rating = Math.max(100, Math.round(mean + (Math.random() * 2 - 1) * spread));
    const taken = new Set(room.players.map((p) => p.name));
    room.addBot({
      id: `bot:${newId()}`,
      name: botName(regionFor(country), taken),
      skin: 'default',
      bot: { controller: new VersusBot(1, skillForRating(rating)), rating, chat: this.deps.chatResponder, lang },
    });
  }

  /** Tells everyone still searching for `kind` how full their match is. Never how long is left. */
  private notify(kind: MatchQueue): void {
    const needed = MATCH_QUEUES[kind].size;
    const waiting = this.queue.filter((t) => t.queue === kind);
    for (const t of waiting) {
      t.link.send({ type: 'queued', queue: kind, searching: true, since: t.queuedAt, found: waiting.length, needed });
    }
  }

  /** The rating a seat plays at, for the result: a bot's is its assigned one. */
  static seatRating(room: Room, userId: string, fallback = STARTING_RATING): number {
    const p = room.players.find((x) => x.id === userId);
    return p?.bot?.rating ?? fallback;
  }
}
