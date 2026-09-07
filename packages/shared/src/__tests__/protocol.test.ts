import { describe, expect, it } from 'vitest';
import { clientMessageSchema, giftSendSchema, guestAuthSchema, nicknameSchema, soloResultSchema } from '../protocol.js';
import { CATALOG, CATALOG_BY_SKU, BATTLEPASS_TIERS, matchRewards } from '../economy.js';

describe('protocol', () => {
  it('accepts valid client messages', () => {
    expect(clientMessageSchema.safeParse({ type: 'input', seq: 1, dir: 0, fire: true }).success).toBe(true);
    expect(clientMessageSchema.safeParse({ type: 'joinRoom', code: 'ABC23' }).success).toBe(true);
    expect(clientMessageSchema.safeParse({ type: 'createRoom', mode: 'coop' }).success).toBe(true);
  });
  it('rejects malformed messages', () => {
    expect(clientMessageSchema.safeParse({ type: 'input', seq: -1, dir: 0, fire: true }).success).toBe(false);
    expect(clientMessageSchema.safeParse({ type: 'input', seq: 1, dir: 7, fire: true }).success).toBe(false);
    expect(clientMessageSchema.safeParse({ type: 'joinRoom', code: 'abc' }).success).toBe(false);
    expect(clientMessageSchema.safeParse({ type: 'nope' }).success).toBe(false);
    expect(clientMessageSchema.safeParse({ type: 'chat', text: 'x'.repeat(200) }).success).toBe(false);
  });
  it('validates nicknames and auth payloads', () => {
    expect(nicknameSchema.safeParse('Tank Ace').success).toBe(true);
    expect(nicknameSchema.safeParse('שחקן_1').success).toBe(true);
    expect(nicknameSchema.safeParse('<script>').success).toBe(false);
    expect(guestAuthSchema.safeParse({}).success).toBe(true);
  });
  it('gift quantities: items up to 10, raw gems up to 5000', () => {
    expect(giftSendSchema.safeParse({ to: 'Bob', sku: 'boost_shield', qty: 10 }).success).toBe(true);
    expect(giftSendSchema.safeParse({ to: 'Bob', sku: 'boost_shield', qty: 11 }).success).toBe(false);
    expect(giftSendSchema.safeParse({ to: 'Bob', sku: 'gems', qty: 500 }).success).toBe(true);
    expect(giftSendSchema.safeParse({ to: 'Bob', sku: 'gems', qty: 5001 }).success).toBe(false);
  });
  it('solo result schema bounds input size', () => {
    expect(soloResultSchema.safeParse({ soloId: 's1', inputs: [[[0, 1]]], commands: [[5, 'grenade']], claimedScore: 0, claimedStage: 1 }).success).toBe(true);
    expect(soloResultSchema.safeParse({ soloId: 's1', inputs: [[[0, 2]]], claimedScore: 0, claimedStage: 1 }).success).toBe(false);
    expect(soloResultSchema.safeParse({ soloId: 's1', inputs: [], commands: [[1, 'nuke']], claimedScore: 0, claimedStage: 1 }).success).toBe(false);
  });
  it('catalog is consistent', () => {
    const skus = new Set<string>();
    for (const item of CATALOG) {
      expect(skus.has(item.sku)).toBe(false);
      skus.add(item.sku);
      expect(Object.keys(item.prices).length).toBeGreaterThan(0);
      if (item.grants?.items) for (const g of Object.keys(item.grants.items)) expect(CATALOG_BY_SKU[g]).toBeTruthy();
    }
    for (const t of BATTLEPASS_TIERS) {
      for (const track of [t.free, t.premium]) if (track?.items) for (const g of Object.keys(track.items)) expect(CATALOG_BY_SKU[g]).toBeTruthy();
    }
    expect(BATTLEPASS_TIERS[29].xp).toBeGreaterThan(BATTLEPASS_TIERS[0].xp);
    expect(matchRewards(5000, 2, 10, true)).toEqual({ coins: 500 + 100 + 20, xp: 100 + 200 + 30 });
  });
});
