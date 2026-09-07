import { CATALOG_BY_SKU, REWARD_RULES } from '@tank/shared';
import type { Db, GiftRow } from '../db/repo.js';
import { badRequest, conflict, notFound, tooMany } from '../util/errors.js';
import { newId } from '../util/ids.js';
import { DAY_MS, type Clock } from '../util/time.js';
import { isGiftable } from './catalog.js';
import type { InventoryDTO, InventoryService } from './inventory.js';
import type { WalletDTO, WalletService } from './wallet.js';

export interface GiftDTO {
  id: string;
  fromName: string;
  toName: string;
  sku: string;
  qty: number;
  message: string;
  status: 'pending' | 'claimed';
  createdAt: number;
}

/** Player-to-player gifts. Items leave the sender immediately and sit in the gift until claimed. */
export class GiftsService {
  constructor(
    private readonly db: Db,
    private readonly wallet: WalletService,
    private readonly inventory: InventoryService,
    private readonly clock: Clock,
  ) {}

  dto(g: GiftRow): GiftDTO {
    const name = (id: string) => this.db.users.get(id)?.nickname ?? 'unknown';
    return { id: g.id, fromName: name(g.fromId), toName: name(g.toId), sku: g.sku, qty: g.qty, message: g.message, status: g.status, createdAt: g.createdAt };
  }

  send(fromId: string, to: string, sku: string, qty: number, message = ''): { gift: GiftDTO; inventory: InventoryDTO; wallet: WalletDTO } {
    const recipient = this.db.users.get(to) ?? this.db.users.getByNickname(to.trim().toLowerCase());
    if (!recipient) throw notFound('recipient not found', 'user_not_found');
    if (recipient.id === fromId) throw badRequest('cannot gift yourself', 'self_gift');
    const now = this.clock();
    return this.db.transaction(() => {
      if (this.db.gifts.countSentSince(fromId, now - DAY_MS) >= REWARD_RULES.giftsPerDay) throw tooMany('daily gift limit reached', 'gift_limit');
      if (sku === 'gems') {
        this.wallet.debit(fromId, 'gems', qty, 'gift', recipient.id);
      } else {
        const item = CATALOG_BY_SKU[sku];
        if (!item || !isGiftable(item)) throw badRequest('item cannot be gifted', 'not_giftable');
        if (!this.inventory.consume(fromId, sku, qty)) throw conflict('not enough items', 'insufficient_items');
      }
      const gift: GiftRow = { id: newId(), fromId, toId: recipient.id, sku, qty, message: message.slice(0, 120), status: 'pending', createdAt: now, claimedAt: null };
      this.db.gifts.insert(gift);
      return { gift: this.dto(gift), inventory: this.inventory.list(fromId), wallet: this.wallet.get(fromId) };
    });
  }

  inbox(userId: string): GiftDTO[] {
    return this.db.gifts.listForRecipient(userId).map((g) => this.dto(g));
  }

  pendingCount(userId: string): number {
    return this.db.gifts.countPending(userId);
  }

  claim(userId: string, giftId: string): { wallet: WalletDTO; inventory: InventoryDTO } {
    return this.db.transaction(() => {
      const g = this.db.gifts.get(giftId);
      if (!g || g.toId !== userId) throw notFound('gift not found', 'gift_not_found');
      if (g.status !== 'pending') throw conflict('gift already claimed', 'already_claimed');
      if (g.sku === 'gems') this.wallet.credit(userId, 'gems', g.qty, 'gift', g.id);
      else this.inventory.add(userId, g.sku, g.qty);
      this.db.gifts.update(g.id, { status: 'claimed', claimedAt: this.clock() });
      return { wallet: this.wallet.get(userId), inventory: this.inventory.list(userId) };
    });
  }
}
