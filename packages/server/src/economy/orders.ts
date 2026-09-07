import { CATALOG, type CatalogItem } from '@tank/shared';
import type { Db, OrderRow } from '../db/repo.js';
import { badRequest, conflict, notFound } from '../util/errors.js';
import { newId } from '../util/ids.js';
import type { Clock } from '../util/time.js';
import type { BattlepassService } from './battlepass.js';
import { getItem, priceOf, usdPriceOf } from './catalog.js';
import { applyGrants } from './grants.js';
import type { InventoryDTO, InventoryService } from './inventory.js';
import type { PaymentProvider } from './payments/provider.js';
import type { WalletDTO, WalletService } from './wallet.js';

export interface OrderDTO {
  id: string;
  sku: string;
  provider: 'mock' | 'stripe';
  status: OrderRow['status'];
  amountCents: number;
  currency: 'usd';
}

export const orderDto = (o: OrderRow): OrderDTO => ({ id: o.id, sku: o.sku, provider: o.provider, status: o.status, amountCents: o.amountCents, currency: o.currency });

/** Store purchases (soft currency), real-money checkout and idempotent fulfilment. */
export class StoreService {
  constructor(
    private readonly db: Db,
    private readonly wallet: WalletService,
    private readonly inventory: InventoryService,
    private readonly battlepass: BattlepassService,
    private readonly provider: PaymentProvider,
    private readonly clock: Clock,
  ) {}

  /** One-time items the user already owns (for greying out in the store). */
  ownedOneTime(userId: string): string[] {
    return CATALOG.filter((i) => i.oneTime).filter((i) => this.ownsOneTime(userId, i)).map((i) => i.sku);
  }

  private ownsOneTime(userId: string, item: CatalogItem): boolean {
    if (item.sku === 'battlepass_premium') return this.battlepass.hasPremium(userId);
    return this.db.orders.hasCompleted(userId, item.sku) || (item.kind === 'cosmetic' && this.inventory.qty(userId, item.sku) > 0);
  }

  /** Buys an item with coins or gems. Prices come from the catalog only. */
  purchase(userId: string, sku: string, qty: number, currency: 'coins' | 'gems'): { wallet: WalletDTO; inventory: InventoryDTO } {
    const item = getItem(sku);
    const unit = priceOf(item, currency);
    if (item.kind === 'currency') throw badRequest('currency packs are sold for usd only', 'not_purchasable');
    const single = item.oneTime || item.kind === 'cosmetic' || item.kind === 'pass';
    if (single && qty !== 1) throw badRequest('this item can only be bought once at a time', 'bad_qty');
    return this.db.transaction(() => {
      if (item.oneTime && this.ownsOneTime(userId, item)) throw conflict('already owned', 'already_owned');
      if (item.kind === 'cosmetic' && this.inventory.qty(userId, sku) > 0) throw conflict('already owned', 'already_owned');
      if (item.kind === 'pass') {
        this.battlepass.buyPremium(userId);
      } else {
        this.wallet.debit(userId, currency, unit * qty, 'purchase', sku);
        if (item.grants) applyGrants(this.wallet, this.inventory, userId, item.grants, 'purchase', sku);
        else this.inventory.add(userId, sku, qty);
      }
      return { wallet: this.wallet.get(userId), inventory: this.inventory.list(userId) };
    });
  }

  async checkout(userId: string, sku: string): Promise<{ orderId: string; provider: 'mock' | 'stripe'; redirectUrl?: string; clientSecret?: string }> {
    const item = getItem(sku);
    const amountCents = usdPriceOf(item);
    if (item.oneTime && this.ownsOneTime(userId, item)) throw conflict('already owned', 'already_owned');
    const now = this.clock();
    const order: OrderRow = { id: newId(), userId, sku, provider: this.provider.name, status: 'pending', amountCents, currency: 'usd', providerRef: null, createdAt: now, updatedAt: now };
    this.db.orders.insert(order);
    try {
      const res = await this.provider.createCheckout(order, { name: item.name, description: item.description });
      return { orderId: order.id, provider: this.provider.name, ...res };
    } catch (err) {
      this.db.orders.update(order.id, { status: 'failed', updatedAt: this.clock() });
      throw err;
    }
  }

  get(orderId: string): OrderRow {
    const o = this.db.orders.get(orderId);
    if (!o) throw notFound('order not found', 'order_not_found');
    return o;
  }

  list(userId: string): OrderDTO[] {
    return this.db.orders.list(userId).map(orderDto);
  }

  /** Idempotent: pending → completed applies the catalog grants exactly once. */
  fulfil(orderId: string, providerRef: string | null = null): OrderRow {
    return this.db.transaction(() => {
      const o = this.get(orderId);
      if (o.status === 'completed') return o;
      if (o.status === 'failed') throw conflict('order failed', 'order_failed');
      const item = getItem(o.sku);
      if (item.oneTime && this.ownsOneTime(o.userId, item)) throw conflict('already owned', 'already_owned');
      if (item.grants) applyGrants(this.wallet, this.inventory, o.userId, item.grants, 'order', o.id);
      else if (item.kind === 'pass') this.battlepass.buyPremium(o.userId);
      else this.inventory.add(o.userId, o.sku, 1);
      return this.db.orders.update(o.id, { status: 'completed', providerRef: providerRef ?? o.providerRef, updatedAt: this.clock() });
    });
  }

  fail(orderId: string, providerRef: string | null = null): OrderRow {
    const o = this.get(orderId);
    if (o.status !== 'pending') return o;
    return this.db.orders.update(o.id, { status: 'failed', providerRef: providerRef ?? o.providerRef, updatedAt: this.clock() });
  }
}
