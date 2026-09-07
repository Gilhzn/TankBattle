import type { CatalogItem } from '@tank/shared';
import type { InventoryService } from './inventory.js';
import type { WalletService } from './wallet.js';

export type Grants = NonNullable<CatalogItem['grants']>;

/** Applies a grant bundle (coins / gems / items) to a user. Caller wraps in a transaction. */
export function applyGrants(wallet: WalletService, inventory: InventoryService, userId: string, grants: Grants, reason: string, ref: string | null): void {
  if (grants.coins) wallet.credit(userId, 'coins', grants.coins, reason, ref);
  if (grants.gems) wallet.credit(userId, 'gems', grants.gems, reason, ref);
  for (const [sku, qty] of Object.entries(grants.items ?? {})) inventory.add(userId, sku, qty);
}
