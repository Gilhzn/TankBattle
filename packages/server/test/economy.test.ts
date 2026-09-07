import { HELMET_TICKS, REWARD_RULES, matchRewards, simulateReplay } from '@tank/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyStripeSignature } from '../src/economy/payments/stripe.js';
import type { RunningServer } from '../src/server.js';
import { WsClient, guest, startTestServer, type AnyMsg, type Guest } from './helpers.js';
import { createHmac } from 'node:crypto';

let server: RunningServer;
let now = Date.UTC(2026, 5, 15, 12);
let A: Guest;
let B: Guest;
const sockets: WsClient[] = [];

beforeAll(async () => {
  server = await startTestServer({ debug: true, clock: () => now, tickRate: 200 });
  A = await guest(server, 'EconAlice');
  B = await guest(server, 'EconBob');
});
afterAll(async () => {
  for (const s of sockets) s.close();
  await server.close();
});

type Wallet = { coins: number; gems: number };
type Inv = Record<string, { qty: number; equipped: boolean }>;

describe('store', () => {
  it('mock checkout completes idempotently and grants gems', async () => {
    const catalog = await A.call('GET', '/api/store/catalog');
    expect(catalog.status).toBe(200);
    expect(catalog.body.provider).toBe('mock');
    const co = await A.call<{ orderId: string; provider: string; redirectUrl: string }>('POST', '/api/store/checkout', { sku: 'gems_550' });
    expect(co.status).toBe(200);
    expect(co.body.redirectUrl).toBe(`/#/checkout/${co.body.orderId}`);
    const done = await A.call<{ order: { status: string }; wallet: Wallet }>('POST', '/api/store/mock/complete', { orderId: co.body.orderId });
    expect(done.status).toBe(200);
    expect(done.body.order.status).toBe('completed');
    expect(done.body.wallet.gems).toBe(550);
    const again = await A.call<{ wallet: Wallet }>('POST', '/api/store/mock/complete', { orderId: co.body.orderId });
    expect(again.body.wallet.gems).toBe(550);
    const other = await B.call('POST', '/api/store/mock/complete', { orderId: co.body.orderId });
    expect(other.status).toBe(403);
    const orders = await A.call<{ orders: Array<{ status: string }> }>('GET', '/api/store/orders');
    expect(orders.body.orders[0].status).toBe('completed');
  });

  it('purchases with coins after a debug credit; rejects unaffordable and unknown items', async () => {
    const poor = await A.call('POST', '/api/store/purchase', { sku: 'boost_grenade', qty: 1, currency: 'coins' });
    expect(poor.status).toBe(409);
    server.debug!.credit(A.id, 'coins', 2000);
    const buy = await A.call<{ wallet: Wallet; inventory: Inv }>('POST', '/api/store/purchase', { sku: 'boost_grenade', qty: 1, currency: 'coins' });
    expect(buy.status).toBe(200);
    expect(buy.body.wallet.coins).toBe(1700);
    expect(buy.body.inventory.boost_grenade.qty).toBe(1);
    expect((await A.call('POST', '/api/store/purchase', { sku: 'nope_sku', qty: 1, currency: 'coins' })).status).toBe(404);
    expect((await A.call('POST', '/api/store/purchase', { sku: 'skin_void', qty: 1, currency: 'coins' })).status).toBe(400);
    const skin = await A.call<{ inventory: Inv }>('POST', '/api/store/purchase', { sku: 'skin_ember', qty: 1, currency: 'gems' });
    expect(skin.status).toBe(200);
    expect((await A.call('POST', '/api/store/purchase', { sku: 'skin_ember', qty: 1, currency: 'gems' })).status).toBe(409);
    const equip = await A.call<{ user: { skin: string }; inventory: Inv }>('POST', '/api/inventory/equip', { sku: 'skin_ember' });
    expect(equip.body.user.skin).toBe('skin_ember');
    expect(equip.body.inventory.skin_ember.equipped).toBe(true);
    expect((await A.call('PATCH', '/api/me', { skin: 'skin_void' })).status).toBe(409);
  });

  it('stripe signature verification accepts a valid fixture and rejects stale/forged ones', () => {
    const secret = 'whsec_test';
    const body = '{"id":"evt_1","type":"checkout.session.completed"}';
    const t = Math.floor(now / 1000);
    const sig = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
    expect(verifyStripeSignature(body, `t=${t},v1=${sig}`, secret, now)).toBe(true);
    expect(verifyStripeSignature(body, `t=${t},v1=${sig}`, 'other', now)).toBe(false);
    expect(verifyStripeSignature(body + ' ', `t=${t},v1=${sig}`, secret, now)).toBe(false);
    expect(verifyStripeSignature(body, `t=${t},v1=${sig}`, secret, now + 10 * 60 * 1000)).toBe(false);
    expect(verifyStripeSignature(body, undefined, secret, now)).toBe(false);
  });
});

describe('in-match items', () => {
  it('useItem consumes a grenade once per inventory unit', async () => {
    const ws = new WsClient(server.wsUrl);
    sockets.push(ws);
    await ws.open();
    await ws.hello(A.token);
    ws.send({ type: 'createRoom', mode: 'coop', isPrivate: true, loadout: [] });
    await ws.waitFor('roomState');
    ws.send({ type: 'startGame' });
    await ws.waitFor('gameStart');
    ws.send({ type: 'useItem', sku: 'boost_grenade', nonce: 'n1' });
    const ok = await ws.waitFor<{ ok: boolean; inventory: Record<string, number> } & AnyMsg>('itemResult', (m) => m.nonce === 'n1');
    expect(ok.ok).toBe(true);
    expect(ok.inventory.boost_grenade ?? 0).toBe(0);
    ws.send({ type: 'useItem', sku: 'boost_grenade', nonce: 'n2' });
    const fail = await ws.waitFor<{ ok: boolean; error: string } & AnyMsg>('itemResult', (m) => m.nonce === 'n2');
    expect(fail.ok).toBe(false);
    expect(fail.error).toBe('not_owned');
    ws.send({ type: 'useItem', sku: 'skin_void', nonce: 'n3' });
    expect((await ws.waitFor<{ error: string } & AnyMsg>('itemResult', (m) => m.nonce === 'n3')).error).toBe('unknown_item');
    const inv = await A.call<{ inventory: Inv }>('GET', '/api/inventory');
    expect(inv.body.inventory.boost_grenade).toBeUndefined();
    ws.send({ type: 'leaveRoom' });
    await ws.waitFor('left');
  });
});

describe('gifts', () => {
  it('moves a shield from A to B via the inbox', async () => {
    await A.call('POST', '/api/store/purchase', { sku: 'boost_shield', qty: 2, currency: 'coins' });
    const sent = await A.call<{ gift: { id: string; toName: string; status: string }; inventory: Inv }>('POST', '/api/gifts/send', { to: 'EconBob', sku: 'boost_shield', qty: 1, message: 'enjoy' });
    expect(sent.status).toBe(200);
    expect(sent.body.gift.toName).toBe('EconBob');
    expect(sent.body.inventory.boost_shield.qty).toBe(1);
    expect((await A.call('POST', '/api/gifts/send', { to: 'EconAlice', sku: 'boost_shield', qty: 1 })).status).toBe(400);
    expect((await A.call('POST', '/api/gifts/send', { to: 'Nobody', sku: 'boost_shield', qty: 1 })).status).toBe(404);
    const me = await B.call<{ pendingGifts: number }>('GET', '/api/me');
    expect(me.body.pendingGifts).toBe(1);
    const inbox = await B.call<{ gifts: Array<{ id: string; fromName: string; status: string }> }>('GET', '/api/gifts/inbox');
    expect(inbox.body.gifts[0]).toMatchObject({ id: sent.body.gift.id, fromName: 'EconAlice', status: 'pending' });
    const claim = await B.call<{ inventory: Inv }>('POST', `/api/gifts/${sent.body.gift.id}/claim`);
    expect(claim.status).toBe(200);
    expect(claim.body.inventory.boost_shield.qty).toBe(1);
    expect((await B.call('POST', `/api/gifts/${sent.body.gift.id}/claim`)).status).toBe(409);
    expect((await A.call('POST', `/api/gifts/${sent.body.gift.id}/claim`)).status).toBe(404);
  });
});

describe('rewards', () => {
  it('daily claim works once per day', async () => {
    const daily = await B.call<{ claimable: boolean; day: number }>('GET', '/api/rewards/daily');
    expect(daily.body).toMatchObject({ claimable: true, day: 1 });
    const claim = await B.call<{ reward: { coins: number }; wallet: Wallet; daily: { streak: number; claimable: boolean } }>('POST', '/api/rewards/daily/claim');
    expect(claim.status).toBe(200);
    expect(claim.body.reward).toEqual({ coins: 100 });
    expect(claim.body.wallet.coins).toBe(100);
    expect(claim.body.daily).toMatchObject({ streak: 1, claimable: false });
    expect((await B.call('POST', '/api/rewards/daily/claim')).status).toBe(409);
  });

  it('ads: too fast is 409, then pays after the minimum watch time (mocked clock)', async () => {
    const start = await B.call<{ adSessionId: string; minSeconds: number; remainingToday: number }>('POST', '/api/rewards/ad/start', { placement: 'menu' });
    expect(start.status).toBe(200);
    expect(start.body.minSeconds).toBe(REWARD_RULES.adMinSeconds);
    expect(start.body.remainingToday).toBe(REWARD_RULES.adMaxPerDay - 1);
    const fast = await B.call('POST', '/api/rewards/ad/complete', { adSessionId: start.body.adSessionId, placement: 'menu' });
    expect(fast.status).toBe(409);
    now += (REWARD_RULES.adMinSeconds + 1) * 1000;
    const done = await B.call<{ coins: number; wallet: Wallet }>('POST', '/api/rewards/ad/complete', { adSessionId: start.body.adSessionId, placement: 'menu' });
    expect(done.status).toBe(200);
    expect(done.body.coins).toBe(REWARD_RULES.adMenuCoins);
    expect(done.body.wallet.coins).toBe(100 + REWARD_RULES.adMenuCoins);
    expect((await B.call('POST', '/api/rewards/ad/complete', { adSessionId: start.body.adSessionId, placement: 'menu' })).status).toBe(409);
    const noMatch = await B.call<{ adSessionId: string }>('POST', '/api/rewards/ad/start', { placement: 'results' });
    now += 20_000;
    expect((await B.call('POST', '/api/rewards/ad/complete', { adSessionId: noMatch.body.adSessionId, placement: 'results' })).status).toBe(409);
  });
});

describe('solo', () => {
  it('re-simulates the replay, pays the simulated score and flags tampered claims', async () => {
    const start = await A.call<{ soloId: string; seed: number; stage: number; boosts: string[]; inventory: Inv }>('POST', '/api/solo/start', { loadout: ['boost_shield', 'boost_clock'], stage: 1 });
    expect(start.status).toBe(200);
    expect(start.body.boosts).toEqual(['shield']);
    expect(start.body.inventory.boost_shield).toBeUndefined();
    // Pin the seed so the expected outcome is deterministic in this test.
    server.app.db.solo.update(start.body.soloId, { seed: 777 });
    const inputs: Array<Array<[number, number]>> = [];
    for (let t = 0; t < 1800; t++) inputs.push([[t < 30 ? 0 : -1, t % 8 === 0 ? 1 : 0]]);
    const expected = simulateReplay({ seed: 777, stage: 1, players: 1, inputs, commands: [{ tick: 1, command: { type: 'shield', slot: 0, ticks: HELMET_TICKS } }] });
    const p = expected.players[0];
    expect(p.score).toBeGreaterThan(0);
    const reward = matchRewards(p.score, expected.stage - 1, p.kills, false);

    const unauthorised = await A.call('POST', '/api/solo/result', { soloId: start.body.soloId, inputs, commands: [[1, 'grenade']], claimedScore: 0, claimedStage: 1 });
    expect(unauthorised.status).toBe(400);
    const walletBefore = (await A.call<{ wallet: Wallet; battlepass: { xp: number } }>('GET', '/api/me')).body;
    const res = await A.call<{ verified: boolean; score: number; stage: number; coins: number; xp: number; wallet: Wallet; battlepass: { xp: number } }>('POST', '/api/solo/result', {
      soloId: start.body.soloId, inputs, commands: [[1, 'shield']], claimedScore: 999999, claimedStage: 9,
    });
    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(false);
    expect(res.body.score).toBe(p.score);
    expect(res.body.stage).toBe(expected.stage);
    expect(res.body.coins).toBe(reward.coins);
    expect(res.body.xp).toBe(reward.xp);
    expect(res.body.wallet.coins).toBe(walletBefore.wallet.coins + reward.coins);
    expect(res.body.battlepass.xp).toBe(walletBefore.battlepass.xp + reward.xp);
    expect(reward.xp).toBeGreaterThan(0);
    expect((await A.call('POST', '/api/solo/result', { soloId: start.body.soloId, inputs, commands: [], claimedScore: 0, claimedStage: 1 })).status).toBe(409);

    const board = await A.call<{ entries: Array<{ rank: number; name: string; score: number }>; me?: { rank: number; score: number } }>('GET', '/api/leaderboard?mode=solo');
    expect(board.body.entries[0]).toMatchObject({ rank: 1, name: 'EconAlice', score: p.score });
    expect(board.body.me?.rank).toBe(1);
    const stats = await A.call<{ stats: { matches: number; bestScore: number } }>('GET', '/api/me');
    expect(stats.body.stats).toMatchObject({ matches: 1, bestScore: p.score });
  });

  it('doubles the latest match coins with a results ad (once)', async () => {
    const latest = server.app.db.matches.latest(A.id)!;
    const ad = await A.call<{ adSessionId: string }>('POST', '/api/rewards/ad/start', { placement: 'results' });
    now += 16_000;
    const before = (await A.call<{ wallet: Wallet }>('GET', '/api/me')).body.wallet.coins;
    const done = await A.call<{ coins: number; wallet: Wallet }>('POST', '/api/rewards/ad/complete', { adSessionId: ad.body.adSessionId, placement: 'results' });
    expect(done.status).toBe(200);
    expect(done.body.coins).toBe(latest.coins);
    expect(done.body.wallet.coins).toBe(before + latest.coins);
    const ad2 = await A.call<{ adSessionId: string }>('POST', '/api/rewards/ad/start', { placement: 'results' });
    now += 16_000;
    expect((await A.call('POST', '/api/rewards/ad/complete', { adSessionId: ad2.body.adSessionId, placement: 'results' })).status).toBe(409);
  });
});

describe('battlepass', () => {
  it('claims reachable tiers and sells premium for 950 gems', async () => {
    server.app.battlepass.addXp(B.id, 5000);
    const bp = await B.call<{ tier: number; premium: boolean }>('GET', '/api/battlepass');
    expect(bp.body.tier).toBeGreaterThanOrEqual(5);
    expect(bp.body.premium).toBe(false);
    const claim = await B.call<{ wallet: Wallet; battlepass: { claimedFree: number[] } }>('POST', '/api/battlepass/claim', { tier: 1, track: 'free' });
    expect(claim.status).toBe(200);
    expect(claim.body.battlepass.claimedFree).toEqual([1]);
    expect((await B.call('POST', '/api/battlepass/claim', { tier: 1, track: 'free' })).status).toBe(409);
    expect((await B.call('POST', '/api/battlepass/claim', { tier: 30, track: 'free' })).status).toBe(409);
    expect((await B.call('POST', '/api/battlepass/claim', { tier: 2, track: 'premium' })).status).toBe(409);
    expect((await B.call('POST', '/api/battlepass/premium')).status).toBe(409);
    server.debug!.credit(B.id, 'gems', 1000);
    const prem = await B.call<{ wallet: Wallet; battlepass: { premium: boolean } }>('POST', '/api/battlepass/premium');
    expect(prem.status).toBe(200);
    expect(prem.body.wallet.gems).toBe(50);
    expect(prem.body.battlepass.premium).toBe(true);
    expect((await B.call('POST', '/api/battlepass/claim', { tier: 2, track: 'premium' })).status).toBe(200);
    const catalog = await B.call<{ ownedOneTime: string[] }>('GET', '/api/store/catalog');
    expect(catalog.body.ownedOneTime).toContain('battlepass_premium');
  });
});
