import { describe, expect, it } from 'vitest';
import { createInitialState, playerTank, Rng, TANK_SIZE, TILE, VERSUS_LIVES, type GameState, type Input } from '@tank/shared';
import { step } from '@tank/shared';
import { skillForRating, VersusBot } from '../src/game/bot.js';
import { botName, regionFor } from '../src/game/botNames.js';
import { ScriptedChatResponder, typingDelayMs } from '../src/game/botChat.js';

const DUEL = [
  { id: 'human', name: 'Human' },
  { id: 'bot', name: 'Bot' },
];

const arena = (): GameState => createInitialState(11, 0, DUEL, 'versus', 'normal', 'ffa');

/** Runs `n` ticks with the bot on slot 1 and the human idle. */
function playOut(s: GameState, bot: VersusBot, n: number, human: Input = { dir: -1, fire: false }): void {
  for (let i = 0; i < n; i++) step(s, [human, bot.think(s)]);
}

describe('bot skill scaling', () => {
  it('reacts faster and aims tighter the higher the rating', () => {
    const low = skillForRating(800);
    const mid = skillForRating(1300);
    const high = skillForRating(1800);
    expect(low.reactionTicks).toBeGreaterThan(mid.reactionTicks);
    expect(mid.reactionTicks).toBeGreaterThan(high.reactionTicks);
    expect(low.aimTolerance).toBeGreaterThan(high.aimTolerance);
    expect(low.dodgeChance).toBeLessThan(high.dodgeChance);
    expect(low.hesitation).toBeGreaterThan(high.hesitation);
  });

  it('clamps outside the rated range rather than going nonsensical', () => {
    expect(skillForRating(0).level).toBe(0);
    expect(skillForRating(9000).level).toBe(1);
    expect(skillForRating(0).reactionTicks).toBeGreaterThan(0);
  });
});

describe('the bot plays the game', () => {
  it('moves its tank rather than sitting on the spawn', () => {
    const s = arena();
    const bot = new VersusBot(1, skillForRating(1200));
    const start = playerTank(s, s.players[1])!;
    const x0 = start.x;
    const y0 = start.y;
    playOut(s, bot, 90);
    const now = playerTank(s, s.players[1])!;
    expect(Math.abs(now.x - x0) + Math.abs(now.y - y0)).toBeGreaterThan(TILE);
  });

  it('stays inside the arena', () => {
    const s = arena();
    const bot = new VersusBot(1, skillForRating(1500));
    playOut(s, bot, 400);
    const t = playerTank(s, s.players[1]);
    if (!t) return; // it may have been killed; that is not this test's concern
    expect(t.x).toBeGreaterThanOrEqual(0);
    expect(t.y).toBeGreaterThanOrEqual(0);
    expect(t.x + TANK_SIZE).toBeLessThanOrEqual(26 * TILE);
    expect(t.y + TANK_SIZE).toBeLessThanOrEqual(26 * TILE);
  });

  it('shoots when an opponent is lined up in front of it', () => {
    const s = arena();
    const bot = new VersusBot(1, skillForRating(1800));
    const me = playerTank(s, s.players[1])!;
    const them = playerTank(s, s.players[0])!;
    // Put them in a clear lane: same row, a few tiles apart, nothing between.
    for (let i = 0; i < s.tiles.length; i++) s.tiles[i] = 0;
    me.x = 6 * TILE;
    me.y = 12 * TILE;
    them.x = 12 * TILE;
    them.y = 12 * TILE;
    me.shieldUntil = 0;
    them.shieldUntil = 0;
    let fired = false;
    for (let i = 0; i < 40 && !fired; i++) {
      const input = bot.think(s);
      if (input.fire) fired = true;
      step(s, [{ dir: -1, fire: false }, input]);
    }
    expect(fired).toBe(true);
  });

  it('does not shoot through steel it cannot break', () => {
    const s = arena();
    const bot = new VersusBot(1, skillForRating(1800));
    const me = playerTank(s, s.players[1])!;
    const them = playerTank(s, s.players[0])!;
    for (let i = 0; i < s.tiles.length; i++) s.tiles[i] = 0;
    me.x = 6 * TILE;
    me.y = 12 * TILE;
    them.x = 12 * TILE;
    them.y = 12 * TILE;
    // A steel wall right across the lane.
    for (let ty = 11; ty <= 14; ty++) for (let tx = 9; tx <= 10; tx++) s.tiles[ty * 26 + tx] = 2;
    let firedAlongLane = false;
    for (let i = 0; i < 12; i++) {
      const input = bot.think(s);
      // dir 1 is "right", straight at the wall.
      if (input.fire && input.dir === 1) firedAlongLane = true;
      step(s, [{ dir: -1, fire: false }, input]);
    }
    expect(firedAlongLane).toBe(false);
  });

  it('gets out of the way of an incoming shell', () => {
    const s = arena();
    // A maximally alert bot, so the dodge roll is not what is being tested.
    const bot = new VersusBot(1, { ...skillForRating(1800), dodgeChance: 1, wander: 0 });
    for (let i = 0; i < s.tiles.length; i++) s.tiles[i] = 0;
    const me = playerTank(s, s.players[1])!;
    me.x = 12 * TILE;
    me.y = 12 * TILE;
    me.shieldUntil = 0;
    const y0 = me.y;
    const x0 = me.x;
    s.bullets.push({
      id: 9001, tankId: 9999, owner: 0, x: 6 * TILE, y: 12 * TILE + TANK_SIZE / 2, px: 6 * TILE, py: 12 * TILE + TANK_SIZE / 2,
      dir: 1, speed: 12, power: 0, fromPlayer: true,
    });
    for (let i = 0; i < 10; i++) step(s, [{ dir: -1, fire: false }, bot.think(s)]);
    const now = playerTank(s, s.players[1]);
    // It should have left the lane the shell was travelling down.
    expect(now && (Math.abs(now.y - y0) > 0 || Math.abs(now.x - x0) > 0)).toBe(true);
  });

  it('never shoots a teammate in 2v2', () => {
    const s = createInitialState(11, 0, [
      { id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }, { id: 'd', name: 'D' },
    ], 'versus', 'normal', 'teams');
    // Slot 2 is on team 0 with slot 0; the bot on slot 0 must never target it.
    const bot = new VersusBot(0, skillForRating(1800));
    const mate = s.players[2];
    const deaths = mate.deaths;
    for (let i = 0; i < 300; i++) step(s, [bot.think(s), { dir: -1, fire: false }, { dir: -1, fire: false }, { dir: -1, fire: false }]);
    expect(s.players[2].deaths).toBe(deaths);
    expect(s.players[2].lives).toBe(VERSUS_LIVES);
  });

  it('a strong bot closes out a passive opponent faster than a weak one', () => {
    // Both eventually beat someone who never moves — three lives is three lives — so the skill
    // signal is how long it takes, not whether it happens.
    const ticksToWin = (rating: number, seed: number): number => {
      const s = createInitialState(seed, 0, DUEL, 'versus', 'normal', 'ffa');
      // Seeded rather than Math.random: the bot's wander and hesitation are noisy enough that an
      // unseeded run makes this comparison a coin toss on a bad day.
      const rng = new Rng(seed);
      const bot = new VersusBot(1, skillForRating(rating), () => rng.int(1_000_000) / 1_000_000);
      const limit = 30 * 90;
      for (let i = 0; i < limit && s.status === 'playing'; i++) step(s, [{ dir: -1, fire: false }, bot.think(s)]);
      return s.players[1].kills >= VERSUS_LIVES ? s.tick : limit;
    };
    // Compared on the median: an occasional run takes three times as long when the opponent keeps
    // respawning behind cover, and one such outlier would swamp a sum.
    const median = (xs: number[]): number => {
      const sorted = [...xs].sort((a, b) => a - b);
      const mid = sorted.length >> 1;
      return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    };
    const seeds = [1, 7, 23, 99, 512, 4242, 8080, 31337, 5150, 90210, 12321, 777];
    const strong = median(seeds.map((s) => ticksToWin(1800, s)));
    const weak = median(seeds.map((s) => ticksToWin(800, s)));
    expect(strong).toBeLessThan(weak);
  });

  it('finds its way around a wall instead of grinding against it', () => {
    // The greedy pathing this replaced pinned the bot in any concave corner, and the tell was that
    // a *worse* bot did better because its random wander shook it loose.
    const s = arena();
    const bot = new VersusBot(1, { ...skillForRating(1800), wander: 0 });
    for (let i = 0; i < s.tiles.length; i++) s.tiles[i] = 0;
    const me = playerTank(s, s.players[1])!;
    const them = playerTank(s, s.players[0])!;
    me.x = 2 * TILE;
    me.y = 12 * TILE;
    them.x = 20 * TILE;
    them.y = 12 * TILE;
    // A steel barrier straight across, with one gap near the top.
    for (let ty = 4; ty < 26; ty++) for (let tx = 10; tx <= 11; tx++) s.tiles[ty * 26 + tx] = 2;
    // Track how far right it ever got: once it is through and has won, it chases the respawn back
    // to the left, so the *final* position says nothing about whether it solved the wall.
    let furthest = me.x;
    for (let i = 0; i < 600; i++) {
      step(s, [{ dir: -1, fire: false }, bot.think(s)]);
      const t = playerTank(s, s.players[1]);
      if (t) furthest = Math.max(furthest, t.x);
    }
    // The barrier sits at tiles 10-11, so anything past 12 means it found the gap and went through.
    expect(furthest).toBeGreaterThan(13 * TILE);
  });
});

describe('bot names', () => {
  it('picks the regional pool for a country it knows, and the global one otherwise', () => {
    expect(regionFor('IL')).toBe('il');
    expect(regionFor('il')).toBe('il');
    expect(regionFor('FR')).toBe('global');
    expect(regionFor(undefined)).toBe('global');
  });

  it('never reuses a name already in the room', () => {
    const taken = new Set(['Yuval', 'Noam', 'Shira']);
    for (let i = 0; i < 200; i++) {
      const n = botName('il', taken);
      expect([...taken].map((t) => t.toLowerCase())).not.toContain(n.toLowerCase());
    }
  });

  it('does not look machine-generated', () => {
    const names = new Set<string>();
    for (let i = 0; i < 200; i++) names.add(botName('global'));
    // A real ladder has variety, and no name should read as "Player_1".
    expect(names.size).toBeGreaterThan(30);
    for (const n of names) expect(n).not.toMatch(/^(player|bot|user|guest)/i);
  });
});

describe('bot chat', () => {
  const ctx = (text: string, over: Partial<Parameters<ScriptedChatResponder['reply']>[0]> = {}) => ({
    text, opponentName: 'Human', selfName: 'Kestrel', lang: 'en' as const, standing: 0 as const, history: [], ...over,
  });

  it('answers a greeting', async () => {
    const r = new ScriptedChatResponder({ rnd: () => 0.1 });
    expect(await r.reply(ctx('hey'))).toBeTruthy();
  });

  it('answers "gg" with a closing line', async () => {
    const r = new ScriptedChatResponder({ rnd: () => 0.1 });
    const reply = await r.reply(ctx('gg'));
    expect(reply?.toLowerCase()).toContain('gg');
  });

  it('answers in Hebrew when the player is playing in Hebrew', async () => {
    const r = new ScriptedChatResponder({ rnd: () => 0.1 });
    const reply = await r.reply(ctx('היי', { lang: 'he' }));
    expect(reply).toBeTruthy();
    expect(reply!).toMatch(/[֐-׿]/);
  });

  it('deflects "are you a bot?" without ever claiming to be human', async () => {
    const r = new ScriptedChatResponder({ rnd: () => 0.1 });
    for (const q of ['are you a bot', 'bot?', 'is this an ai', 'אתה בוט?']) {
      const reply = (await r.reply(ctx(q, { lang: q.match(/[֐-׿]/) ? 'he' : 'en' })))?.toLowerCase() ?? '';
      expect(reply).toBeTruthy();
      expect(reply).not.toMatch(/\b(i am|i'm|im) (a )?(human|real|person)\b/);
      expect(reply).not.toMatch(/\bnot a bot\b/);
      expect(reply).not.toMatch(/\bאני (בן ?אדם|אמיתי)\b/);
    }
  });

  it('stays quiet sometimes, the way a real player does', async () => {
    const r = new ScriptedChatResponder({ rnd: () => 0.99 });
    expect(await r.reply(ctx('anything at all'))).toBeNull();
  });

  it('says nothing to an empty message', async () => {
    const r = new ScriptedChatResponder({ rnd: () => 0 });
    expect(await r.reply(ctx('   '))).toBeNull();
  });

  it('avoids repeating a line it already used this match', async () => {
    const r = new ScriptedChatResponder({ rnd: () => 0.1 });
    const first = await r.reply(ctx('gg'));
    const second = await r.reply(ctx('gg', { history: [first!] }));
    expect(second).not.toBe(first);
  });

  it('takes longer to "type" a longer reply, and never answers instantly', () => {
    const short = typingDelayMs('gg', () => 0.5);
    const long = typingDelayMs('that was a really close one nice play', () => 0.5);
    expect(short).toBeGreaterThan(600);
    expect(long).toBeGreaterThan(short);
  });
});
