import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { arenaIndexForRating, teamOf, type ServerMessage } from '@tank/shared';
import { Matchmaker, type Ticket } from '../src/rooms/matchmaker.js';
import { RoomManager } from '../src/rooms/roomManager.js';
import { ScriptedChatResponder } from '../src/game/botChat.js';
import { createLogger } from '../src/util/log.js';
import type { Room } from '../src/rooms/room.js';

/** A link that records what the server sent it. */
class Sink {
  readonly sent: ServerMessage[] = [];
  send(msg: ServerMessage): void {
    this.sent.push(msg);
  }
  has(type: string): boolean {
    return this.sent.some((m) => m.type === type);
  }
}

describe('matchmaking', () => {
  let now = 1_000_000;
  const clock = () => now;
  const log = createLogger('error', 'test');
  let rooms: RoomManager;
  let mm: Matchmaker;
  let matched: Array<{ ticket: Ticket; room: Room }>;

  const ticket = (id: string, rating: number, over: Partial<Ticket> = {}): Ticket => ({
    user: { id, name: id, skin: 'default' },
    link: new Sink(),
    rating,
    country: 'IL',
    lang: 'en',
    queue: '1v1',
    loadout: [],
    queuedAt: now,
    // Set by the matchmaker from `fillAfterMs` when the ticket is enqueued.
    fillAt: 0,
    ...over,
  });

  beforeEach(() => {
    now = 1_000_000;
    matched = [];
    rooms = new RoomManager({
      clock,
      log,
      countdownMs: 10,
      // The runner is never started in these tests; matchmaking is what is under test.
      createRunner: () => ({ start() {}, stop() {}, removePlayer() {}, clearInput() {} }) as never,
    });
    mm = new Matchmaker({
      rooms,
      clock,
      log,
      // Pinned, so "the wait ran out" is a fact in these tests rather than a coin toss.
      fillAfterMs: () => 20_000,
      chatResponder: new ScriptedChatResponder(),
      onMatched: (t, room) => matched.push({ ticket: t, room }),
    });
  });
  afterEach(() => {
    mm.stop();
    rooms.close();
  });

  it('pairs two players of similar rating straight away', () => {
    mm.enqueue(ticket('a', 1000));
    mm.enqueue(ticket('b', 1020));
    expect(matched).toHaveLength(2);
    expect(matched[0].room).toBe(matched[1].room);
    expect(mm.size).toBe(0);
  });

  it('will not pair a beginner with an expert at first', () => {
    mm.enqueue(ticket('a', 900));
    mm.enqueue(ticket('b', 1700));
    expect(matched).toHaveLength(0);
    expect(mm.size).toBe(2);
  });

  it('widens the search the longer someone waits, so nobody is stuck forever', () => {
    mm.enqueue(ticket('a', 900));
    mm.enqueue(ticket('b', 1700));
    expect(matched).toHaveLength(0);
    // 800 points apart needs both windows open past 800, which takes a while.
    now += 19_000;
    (mm as unknown as { pump(): void }).pump();
    expect(matched).toHaveLength(2);
  });

  it('picks the closest opponent when several are waiting', () => {
    mm.enqueue(ticket('far', 1150));
    mm.enqueue(ticket('near', 1010));
    mm.enqueue(ticket('seeker', 1000));
    const names = matched.map((m) => m.ticket.user.id).sort();
    expect(names).toEqual(['near', 'seeker']);
  });

  it('never groups across queues: two people searching for different games are not each other\'s match', () => {
    mm.enqueue(ticket('a', 1000, { queue: '1v1' }));
    mm.enqueue(ticket('b', 1000, { queue: 'ffa' }));
    expect(matched).toHaveLength(0);
  });

  it('fills a 4-player deathmatch from four searchers', () => {
    for (const [id, r] of [['a', 1000], ['b', 1010], ['c', 1020], ['d', 1030]] as const) mm.enqueue(ticket(id, r, { queue: 'ffa' }));
    expect(matched).toHaveLength(4);
    const room = matched[0].room;
    expect(matched.every((m) => m.room === room)).toBe(true);
    expect(room.players).toHaveLength(4);
    expect(room.versusFormat).toBe('ffa');
    expect(mm.size).toBe(0);
  });

  it('does not start a deathmatch with three when a fourth may still turn up', () => {
    for (const [id, r] of [['a', 1000], ['b', 1010], ['c', 1020]] as const) mm.enqueue(ticket(id, r, { queue: 'ffa' }));
    expect(matched).toHaveLength(0);
    expect(mm.waiting('ffa')).toBe(3);
  });

  it('balances the two sides of a 2v2 as evenly as four ratings allow', () => {
    for (const [id, r] of [['a', 1000], ['b', 1020], ['c', 1040], ['d', 1060]] as const) mm.enqueue(ticket(id, r, { queue: '2v2' }));
    expect(matched).toHaveLength(4);
    const room = matched[0].room;
    expect(room.versusFormat).toBe('teams');
    const ratingOf: Record<string, number> = { a: 1000, b: 1020, c: 1040, d: 1060 };
    const sides = [0, 1].map((team) =>
      room.players.filter((p) => teamOf(p.slot, 'versus', 'teams') === team).reduce((sum, p) => sum + ratingOf[p.id], 0),
    );
    // {1000,1060} against {1020,1040}: the closest split there is.
    expect(Math.abs(sides[0] - sides[1])).toBe(0);
  });

  it('starts a deathmatch with whoever is there once the wait runs out, with no filled seats', () => {
    mm.enqueue(ticket('a', 1000, { queue: 'ffa' }));
    mm.enqueue(ticket('b', 1010, { queue: 'ffa' }));
    expect(matched).toHaveLength(0);
    now += 20_000;
    (mm as unknown as { pump(): void }).pump();
    expect(matched).toHaveLength(2);
    expect(matched[0].room.players).toHaveLength(2);
    expect(matched[0].room.players.some((p) => p.bot)).toBe(false);
  });

  it('fills a 2v2 to four, because three players would be a two-against-one', () => {
    mm.enqueue(ticket('lonely', 1000, { queue: '2v2' }));
    now += 20_000;
    (mm as unknown as { pump(): void }).pump();
    const room = matched[0].room;
    expect(room.players).toHaveLength(4);
    expect(room.players.filter((p) => p.bot)).toHaveLength(3);
  });

  it('starts co-op alone rather than holding someone in a queue for a campaign they can play solo', () => {
    mm.enqueue(ticket('solo', 1000, { queue: 'coop' }));
    now += 20_000;
    (mm as unknown as { pump(): void }).pump();
    expect(matched).toHaveLength(1);
    expect(matched[0].room.mode).toBe('coop');
    expect(matched[0].room.players).toHaveLength(1);
  });

  it('tells everyone searching how full their match is', () => {
    const a = ticket('a', 1000, { queue: 'ffa' });
    mm.enqueue(a);
    const sink = a.link as Sink;
    const progress = (): Array<{ found: number; needed: number }> =>
      sink.sent.filter((m) => m.type === 'queued').map((m) => ({ found: (m as { found: number }).found, needed: (m as { needed: number }).needed }));
    expect(progress().at(-1)).toEqual({ found: 1, needed: 4 });
    mm.enqueue(ticket('b', 1010, { queue: 'ffa' }));
    expect(progress().at(-1)).toEqual({ found: 2, needed: 4 });
    mm.leave('b');
    expect(progress().at(-1)).toEqual({ found: 1, needed: 4 });
  });

  it('never tells the player how long is left', () => {
    const a = ticket('a', 1000, { queue: 'ffa' });
    mm.enqueue(a);
    now += 12_000;
    mm.enqueue(ticket('b', 1010, { queue: 'ffa' }));
    // A countdown on the wire is a countdown on the screen, and the whole point is not to show one.
    for (const m of (a.link as Sink).sent.filter((x) => x.type === 'queued')) {
      expect(Object.keys(m)).not.toContain('startsInMs');
    }
  });

  it('draws a fresh wait for every search', () => {
    const draws: number[] = [];
    const spread = new Matchmaker({
      rooms,
      clock,
      log,
      fillAfterMs: () => {
        const ms = 9_000 + draws.length * 1_000;
        draws.push(ms);
        return ms;
      },
      chatResponder: new ScriptedChatResponder(),
      onMatched: () => undefined,
    });
    const a = ticket('a', 1000, { queue: 'ffa' });
    const b = ticket('b', 4000, { queue: 'ffa' });
    spread.enqueue(a);
    spread.enqueue(b);
    // Each ticket carries its own deadline, so the fill never lands on one shared beat.
    expect(a.fillAt).toBe(a.queuedAt + 9_000);
    expect(b.fillAt).toBe(b.queuedAt + 10_000);
    expect(a.fillAt).not.toBe(b.fillAt);
    spread.stop();
  });

  it('starts as soon as any one search has waited out its own deadline', () => {
    const short = ticket('short', 1000, { queue: 'ffa' });
    const long = ticket('long', 4000, { queue: 'ffa' });
    const mixed = new Matchmaker({
      rooms,
      clock,
      log,
      fillAfterMs: () => (mixed.size === 0 ? 30_000 : 10_000),
      chatResponder: new ScriptedChatResponder(),
      onMatched: (t, room) => matched.push({ ticket: t, room }),
    });
    mixed.enqueue(long);
    mixed.enqueue(short);
    now += 10_000;
    (mixed as unknown as { pump(): void }).pump();
    // `long` still has 20s on its own clock, but `short` expired and the match starts for both.
    expect(matched.length).toBeGreaterThan(0);
    mixed.stop();
  });

  it('sets the arena from the group\'s rating band', () => {
    mm.enqueue(ticket('a', 1000));
    mm.enqueue(ticket('b', 1040));
    expect(matched[0].room.stage).toBe(arenaIndexForRating(1020));
  });

  it('fills the match itself once the wait runs out', () => {
    const t = ticket('lonely', 1200);
    mm.enqueue(t);
    expect(matched).toHaveLength(0);
    now += 20_000;
    (mm as unknown as { pump(): void }).pump();
    expect(matched).toHaveLength(1);
    const room = matched[0].room;
    expect(room.players).toHaveLength(2);
    expect(mm.size).toBe(0);
  });

  it('gives the filled seat a human-looking name and a nearby rating', () => {
    mm.enqueue(ticket('lonely', 1200));
    now += 20_000;
    (mm as unknown as { pump(): void }).pump();
    const bot = matched[0].room.players.find((p) => p.bot)!;
    expect(bot).toBeTruthy();
    // Whole words: a name like "Shai" contains "ai" without announcing anything.
    expect(bot.name).not.toMatch(/\b(bot|ai|cpu|npc|computer)\b/i);
    expect(Math.abs(bot.bot!.rating - 1200)).toBeLessThanOrEqual(40);
  });

  it('does not label the filled seat as anything but a player on the wire', () => {
    mm.enqueue(ticket('lonely', 1200));
    now += 20_000;
    (mm as unknown as { pump(): void }).pump();
    const state = matched[0].room.stateFor('lonely');
    // Room state carries the same fields for every seat; nothing distinguishes the filled one.
    expect(state.players).toHaveLength(2);
    expect(JSON.stringify(state)).not.toMatch(/"bot"|isBot/);
  });

  it('waits the configured time before filling, not before', () => {
    mm.enqueue(ticket('lonely', 1200));
    now += 19_000;
    (mm as unknown as { pump(): void }).pump();
    expect(matched).toHaveLength(0);
    now += 1_500;
    (mm as unknown as { pump(): void }).pump();
    expect(matched).toHaveLength(1);
  });

  it('prefers a real opponent who turns up before the timer', () => {
    mm.enqueue(ticket('a', 1200));
    now += 19_000;
    mm.enqueue(ticket('b', 1210));
    expect(matched).toHaveLength(2);
    expect(matched.every((m) => !m.room.players.some((p) => p.bot))).toBe(true);
  });

  it('lets a player leave the queue', () => {
    mm.enqueue(ticket('a', 1000));
    expect(mm.leave('a')).toBe(true);
    expect(mm.size).toBe(0);
    mm.enqueue(ticket('b', 1000));
    expect(matched).toHaveLength(0);
  });

  it('replaces a duplicate ticket rather than queueing the same player twice', () => {
    mm.enqueue(ticket('a', 1000));
    mm.enqueue(ticket('a', 1000));
    expect(mm.size).toBe(1);
  });

  it('serves the longest waiter first', () => {
    const early = ticket('early', 1000);
    mm.enqueue(early);
    now += 5_000;
    mm.enqueue(ticket('late', 1000, { queuedAt: now }));
    now += 100;
    mm.enqueue(ticket('newcomer', 1000, { queuedAt: now }));
    // The first pair formed should include the player who has been waiting longest.
    expect(matched.map((m) => m.ticket.user.id)).toContain('early');
  });
});
