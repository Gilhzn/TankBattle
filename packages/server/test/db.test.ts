import { describe, expect, it } from 'vitest';
import { loadSqlite } from '../src/db/index.js';
import { createJsonDb } from '../src/db/json.js';
import type { Db, UserRow } from '../src/db/repo.js';
import { createSqliteDb } from '../src/db/sqlite.js';
import { BattlepassService, tierForXp } from '../src/economy/battlepass.js';
import { GiftsService } from '../src/economy/gifts.js';
import { InventoryService } from '../src/economy/inventory.js';
import { StoreService } from '../src/economy/orders.js';
import { MockProvider } from '../src/economy/payments/mock.js';
import { RewardsService } from '../src/economy/rewards.js';
import { InsufficientFunds, WalletService } from '../src/economy/wallet.js';
import { DAY_MS } from '../src/util/time.js';

const sqlite = loadSqlite();
const stores: Array<[string, () => Db]> = [['json', () => createJsonDb(null)]];
if (sqlite) stores.push(['sqlite', () => createSqliteDb(sqlite, ':memory:')]);

const user = (id: string, nick: string): UserRow => ({ id, deviceHash: `h-${id}`, nickname: nick, nicknameLc: nick.toLowerCase(), skin: 'default', settings: {}, createdAt: 1, lastSeen: 1, country: 'IL' });

describe.each(stores)('repository (%s)', (_name, open) => {
  function setup() {
    const db = open();
    let now = Date.UTC(2026, 2, 10, 12);
    const clock = () => now;
    const wallet = new WalletService(db, clock);
    const inventory = new InventoryService(db);
    const battlepass = new BattlepassService(db, wallet, inventory, clock);
    const store = new StoreService(db, wallet, inventory, battlepass, new MockProvider(), clock);
    const rewards = new RewardsService(db, wallet, inventory, clock);
    const gifts = new GiftsService(db, wallet, inventory, clock);
    db.users.insert(user('u1', 'Alice'));
    db.users.insert(user('u2', 'Bob'));
    return { db, wallet, inventory, battlepass, store, rewards, gifts, clock, advance: (ms: number) => (now += ms) };
  }

  it('users: lookup by id / device hash / nickname, unique nicknames', () => {
    const { db } = setup();
    expect(db.users.get('u1')?.nickname).toBe('Alice');
    expect(db.users.getByDeviceHash('h-u2')?.id).toBe('u2');
    expect(db.users.getByNickname('alice')?.id).toBe('u1');
    expect(() => db.users.insert(user('u3', 'ALICE'))).toThrow();
    db.users.update('u1', { nickname: 'Alicia', nicknameLc: 'alicia', settings: { sfx: false } });
    expect(db.users.get('u1')?.settings).toEqual({ sfx: false });
    expect(db.users.getByNickname('alicia')?.id).toBe('u1');
    expect(db.users.count()).toBe(2);
  });

  it('wallet: credit/debit write ledger rows; debit below zero throws and changes nothing', () => {
    const { db, wallet } = setup();
    expect(wallet.get('u1')).toEqual({ coins: 0, gems: 0 });
    wallet.credit('u1', 'coins', 500, 'test');
    wallet.debit('u1', 'coins', 120, 'purchase', 'boost_x');
    expect(wallet.get('u1')).toEqual({ coins: 380, gems: 0 });
    expect(() => wallet.debit('u1', 'coins', 381, 'purchase')).toThrow(InsufficientFunds);
    expect(wallet.get('u1').coins).toBe(380);
    const ledger = db.ledger.list('u1');
    expect(ledger).toHaveLength(2);
    expect(ledger[0]).toMatchObject({ amount: -120, balanceAfter: 380, reason: 'purchase', ref: 'boost_x' });
  });

  it('transaction rolls back on throw', () => {
    const { db, wallet } = setup();
    expect(() =>
      db.transaction(() => {
        wallet.credit('u1', 'gems', 50, 'test');
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(wallet.get('u1').gems).toBe(0);
    expect(db.ledger.list('u1')).toHaveLength(0);
  });

  it('inventory: add, consume, equip one per category', () => {
    const { inventory } = setup();
    inventory.add('u1', 'boost_shield', 2);
    expect(inventory.consume('u1', 'boost_shield')).toBe(true);
    expect(inventory.consume('u1', 'boost_shield', 5)).toBe(false);
    expect(inventory.qty('u1', 'boost_shield')).toBe(1);
    inventory.add('u1', 'skin_ember', 1);
    inventory.add('u1', 'skin_void', 1);
    inventory.equip('u1', 'skin_ember');
    inventory.equip('u1', 'skin_void');
    const inv = inventory.list('u1');
    expect(inv.skin_ember.equipped).toBe(false);
    expect(inv.skin_void.equipped).toBe(true);
    expect(() => inventory.equip('u1', 'boost_shield')).toThrow();
  });

  it('orders: checkout + fulfil is idempotent; one-time items cannot be bought twice', async () => {
    const { db, store, wallet, inventory } = setup();
    const co = await store.checkout('u1', 'gems_550');
    expect(co.provider).toBe('mock');
    expect(co.redirectUrl).toBe(`/#/checkout/${co.orderId}`);
    expect(db.orders.get(co.orderId)?.status).toBe('pending');
    store.fulfil(co.orderId);
    store.fulfil(co.orderId);
    expect(wallet.get('u1').gems).toBe(550);
    expect(store.list('u1')[0].status).toBe('completed');
    const pack = await store.checkout('u1', 'starter_pack');
    store.fulfil(pack.orderId);
    expect(inventory.qty('u1', 'boost_shield')).toBe(3);
    expect(inventory.qty('u1', 'skin_ember')).toBe(1);
    expect(store.ownedOneTime('u1')).toContain('starter_pack');
    await expect(store.checkout('u1', 'starter_pack')).rejects.toMatchObject({ status: 409 });
    expect(() => store.purchase('u1', 'gems_550', 1, 'coins')).toThrow();
  });

  it('gifts: items move from sender to a pending gift, then to the recipient', () => {
    const { inventory, gifts, wallet } = setup();
    inventory.add('u1', 'boost_grenade', 2);
    wallet.credit('u1', 'gems', 100, 'test');
    const sent = gifts.send('u1', 'bob', 'boost_grenade', 1, 'gg');
    expect(sent.gift).toMatchObject({ fromName: 'Alice', toName: 'Bob', sku: 'boost_grenade', qty: 1, status: 'pending' });
    expect(sent.inventory.boost_grenade.qty).toBe(1);
    const gemGift = gifts.send('u1', 'u2', 'gems', 40);
    expect(gemGift.wallet.gems).toBe(60);
    expect(() => gifts.send('u1', 'u1', 'gems', 1)).toThrow();
    expect(() => gifts.send('u1', 'bob', 'gems_550', 1)).toThrow();
    const inbox = gifts.inbox('u2');
    expect(inbox).toHaveLength(2);
    expect(gifts.pendingCount('u2')).toBe(2);
    gifts.claim('u2', sent.gift.id);
    gifts.claim('u2', gemGift.gift.id);
    expect(() => gifts.claim('u2', sent.gift.id)).toThrow();
    expect(inventory.qty('u2', 'boost_grenade')).toBe(1);
    expect(wallet.get('u2').gems).toBe(40);
    expect(gifts.inbox('u2').every((g) => g.status === 'claimed')).toBe(true);
  });

  it('battlepass: xp → tier, claims are validated, premium costs gems', () => {
    const { battlepass, wallet, inventory } = setup();
    expect(tierForXp(0)).toBe(0);
    battlepass.addXp('u1', 1000);
    const bp = battlepass.get('u1');
    expect(bp.tier).toBe(2);
    expect(() => battlepass.claim('u1', 3, 'free')).toThrow();
    expect(() => battlepass.claim('u1', 1, 'premium')).toThrow();
    battlepass.claim('u1', 1, 'free');
    expect(wallet.get('u1').coins).toBe(70);
    expect(() => battlepass.claim('u1', 1, 'free')).toThrow();
    expect(() => battlepass.buyPremium('u1')).toThrow(InsufficientFunds);
    wallet.credit('u1', 'gems', 1000, 'test');
    battlepass.buyPremium('u1');
    expect(wallet.get('u1').gems).toBe(50);
    battlepass.claim('u1', 1, 'premium');
    expect(inventory.qty('u1', 'boost_grenade')).toBe(1);
    expect(battlepass.get('u1').claimedPremium).toEqual([1]);
  });

  it('daily: once per UTC day, streak continues on consecutive days and resets after a gap', () => {
    const { rewards, wallet, advance } = setup();
    expect(rewards.daily('u1')).toMatchObject({ streak: 0, day: 1, claimable: true });
    const first = rewards.claimDaily('u1');
    expect(first.reward).toEqual({ coins: 100 });
    expect(first.daily).toMatchObject({ streak: 1, day: 2, claimable: false });
    expect(() => rewards.claimDaily('u1')).toThrow();
    advance(DAY_MS);
    expect(rewards.claimDaily('u1').daily.streak).toBe(2);
    advance(DAY_MS);
    expect(rewards.claimDaily('u1').reward).toEqual({ items: { boost_shield: 1 } });
    advance(3 * DAY_MS);
    expect(rewards.claimDaily('u1').daily.streak).toBe(1);
    expect(wallet.get('u1').coins).toBe(350);
  });

  it('matches: stats and leaderboard best-per-user', () => {
    const { db } = setup();
    db.matches.insert({ id: 'm1', userId: 'u1', mode: 'solo', score: 300, stage: 1, kills: 3, coins: 30, xp: 6, createdAt: 1 });
    db.matches.insert({ id: 'm2', userId: 'u1', mode: 'solo', score: 900, stage: 2, kills: 6, coins: 90, xp: 12, createdAt: 2 });
    db.matches.insert({ id: 'm3', userId: 'u2', mode: 'solo', score: 500, stage: 1, kills: 2, coins: 50, xp: 10, createdAt: 3 });
    expect(db.matches.stats('u1')).toEqual({ matches: 2, bestScore: 900, bestStage: 2, kills: 9 });
    expect(db.matches.latest('u1')?.id).toBe('m2');
    expect(db.matches.bestPerUser('solo').map((m) => m.id)).toEqual(['m2', 'm3']);
    expect(db.matches.bestPerUser('coop')).toEqual([]);
  });
});
