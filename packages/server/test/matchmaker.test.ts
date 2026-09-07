import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { arenaIndexForRating, type ServerMessage } from '@tank/shared';
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

describe('ranked matchmaking', () => {
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
    format: 'ffa',
    loadout: [],
    queuedAt: now,
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
      botTimeoutMs: 20_000,
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

  it('never pairs across formats, since the format decides who may shoot whom', () => {
    mm.enqueue(ticket('a', 1000, { format: 'ffa' }));
    mm.enqueue(ticket('b', 1000, { format: 'teams' }));
    expect(matched).toHaveLength(0);
  });

  it('sets the arena from the pair\'s rating band', () => {
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
    expect(bot.name).not.toMatch(/bot|ai|cpu|computer/i);
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
