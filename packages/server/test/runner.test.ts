import { DIFFICULTY } from '@tank/shared';
import type { ServerMessage } from '@tank/shared';
import { describe, expect, it } from 'vitest';
import { createJsonDb } from '../src/db/json.js';
import { BattlepassService } from '../src/economy/battlepass.js';
import { InventoryService } from '../src/economy/inventory.js';
import { WalletService } from '../src/economy/wallet.js';
import { ResultsService } from '../src/game/results.js';
import { GameRunner } from '../src/game/runner.js';
import { RoomManager } from '../src/rooms/roomManager.js';
import type { PlayerLink } from '../src/rooms/types.js';
import { createLogger } from '../src/util/log.js';
import { sleep } from './helpers.js';

class FakeLink implements PlayerLink {
  messages: ServerMessage[] = [];
  send(msg: ServerMessage): void {
    this.messages.push(msg);
  }
  of<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }>[] {
    return this.messages.filter((m) => m.type === type) as Extract<ServerMessage, { type: T }>[];
  }
}

function setup() {
  const db = createJsonDb(null);
  const clock = () => Date.now();
  const log = createLogger('silent');
  const wallet = new WalletService(db, clock);
  const inventory = new InventoryService(db);
  const battlepass = new BattlepassService(db, wallet, inventory, clock);
  const results = new ResultsService(db, wallet, battlepass, clock);
  const rooms = new RoomManager({
    clock,
    log,
    countdownMs: 1,
    createRunner: (room) => new GameRunner(room, { inventory, wallet, results, log, tickRate: 30, snapshotEvery: 2, fullSnapshotEvery: 60, reviveGraceTicks: 30 }),
  });
  for (const id of ['p1', 'p2']) db.users.insert({ id, deviceHash: id, nickname: id, nicknameLc: id, skin: 'default', settings: {}, createdAt: 0, lastSeen: 0 });
  return { db, wallet, inventory, battlepass, rooms };
}

describe('GameRunner', () => {
  it('applies at-start boosts, runs to game over and settles rewards', async () => {
    const { db, wallet, inventory, battlepass, rooms } = setup();
    inventory.add('p1', 'boost_life', 1);
    inventory.add('p1', 'boost_star', 1);
    const l1 = new FakeLink();
    const l2 = new FakeLink();
    const room = rooms.create({ id: 'p1', name: 'p1', skin: 'default' }, l1, 'coop', false, ['boost_life', 'boost_star', 'boost_grenade']);
    room.join({ id: 'p2', name: 'p2', skin: 'skin_void' }, l2, []);
    room.start('p1');
    expect(room.status).toBe('countdown');
    await sleep(20);
    expect(room.status).toBe('playing');
    const runner = room.runner!;
    expect(l1.of('gameStart')[0].yourSlot).toBe(0);
    expect(l2.of('gameStart')[0].yourSlot).toBe(1);
    expect(inventory.qty('p1', 'boost_life')).toBe(0);
    expect(inventory.qty('p1', 'boost_star')).toBe(0);
    runner.stepTicks(1);
    // The boost grants one life on top of whatever the room's difficulty starts players with.
    expect(runner.state.players[0].lives).toBe(DIFFICULTY[runner.state.difficulty].lives + 1);
    expect(runner.state.players[0].tier).toBe(1);
    expect(runner.state.players[0].usedItems).toEqual({ boost_life: 1, boost_star: 1 });
    expect(runner.state.players[1].skin).toBe('skin_void');

    // Second player leaves mid-game → removed from the sim, host stays.
    room.leave('p2');
    runner.stepTicks(1);
    expect(runner.state.players[1].active).toBe(false);

    let guard = 0;
    while (room.status === 'playing' && guard++ < 200) runner.stepTicks(500);
    expect(room.status).toBe('lobby');
    const over = l1.of('gameOver');
    expect(over).toHaveLength(1);
    expect(['base', 'lives']).toContain(over[0].reason);
    expect(over[0].results).toHaveLength(1);
    const r = over[0].results[0];
    expect(r.playerId).toBe('p1');
    expect(r.stageReached).toBeGreaterThanOrEqual(1);
    expect(wallet.get('p1').coins).toBe(r.coins);
    expect(battlepass.get('p1').xp).toBe(r.xp);
    expect(db.matches.latest('p1')).toMatchObject({ mode: 'coop', score: r.score, coins: r.coins });
    expect(db.matches.latest('p2')).toBeUndefined();
    const idx = l1.messages.findIndex((m) => m.type === 'gameOver');
    expect(l1.messages[idx + 1].type).toBe('walletUpdate');
    const lobby = l1.messages[idx + 2];
    expect(lobby.type === 'roomState' && lobby.status === 'lobby' && lobby.players[0].ready === false).toBe(true);
    expect(l1.of('snapshot').some((m) => (m.snapshot as { full: boolean }).full)).toBe(true);
    rooms.close();
  });

  it('ignores boosts in versus and rejects useItem outside of play', () => {
    const { inventory, rooms } = setup();
    inventory.add('p1', 'boost_shield', 1);
    inventory.add('p1', 'boost_grenade', 1);
    const l1 = new FakeLink();
    const room = rooms.create({ id: 'p1', name: 'p1', skin: 'default' }, l1, 'versus', true, ['boost_shield']);
    room.start();
    // Force the countdown to elapse synchronously.
    return sleep(20).then(() => {
      const runner = room.runner!;
      expect(inventory.qty('p1', 'boost_shield')).toBe(1);
      const p = room.player('p1')!;
      expect(runner.useItem(p, 'boost_grenade', 'x')).toMatchObject({ ok: false, error: 'versus' });
      expect(inventory.qty('p1', 'boost_grenade')).toBe(1);
      room.leave('p1');
      expect(room.runner).toBeNull();
      rooms.close();
    });
  });
});
