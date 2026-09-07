import { CATALOG_BY_SKU } from '@tank/shared';
import type { Db } from '../db/repo.js';
import { badRequest, conflict } from '../util/errors.js';

export type InventoryDTO = Record<string, { qty: number; equipped: boolean }>;

/** Cosmetic category derived from the sku prefix (only one equipped per category). */
export function cosmeticCategory(sku: string): string {
  return sku.split('_')[0];
}

/** Item ownership: add / consume / equip. Balances never live here. */
export class InventoryService {
  constructor(private readonly db: Db) {}

  list(userId: string): InventoryDTO {
    const out: InventoryDTO = {};
    for (const r of this.db.inventory.list(userId)) out[r.sku] = { qty: r.qty, equipped: r.equipped };
    return out;
  }

  /** Quantities only (the WS `itemResult` shape). */
  counts(userId: string): Record<string, number> {
    const out: Record<string, number> = {};
    for (const r of this.db.inventory.list(userId)) out[r.sku] = r.qty;
    return out;
  }

  qty(userId: string, sku: string): number {
    return this.db.inventory.get(userId, sku)?.qty ?? 0;
  }

  add(userId: string, sku: string, n: number): void {
    if (n <= 0) return;
    this.db.transaction(() => {
      const cur = this.db.inventory.get(userId, sku);
      this.db.inventory.put({ userId, sku, qty: (cur?.qty ?? 0) + n, equipped: cur?.equipped ?? false });
    });
  }

  /** Removes `n` units if owned. Returns false (and changes nothing) when the user owns fewer. */
  consume(userId: string, sku: string, n = 1): boolean {
    return this.db.transaction(() => {
      const cur = this.db.inventory.get(userId, sku);
      if (!cur || cur.qty < n) return false;
      const left = cur.qty - n;
      if (left === 0 && !cur.equipped) this.db.inventory.remove(userId, sku);
      else this.db.inventory.put({ ...cur, qty: left });
      return true;
    });
  }

  /** Equips a cosmetic the user owns; unequips other cosmetics of the same category. */
  equip(userId: string, sku: string): InventoryDTO {
    const item = CATALOG_BY_SKU[sku];
    if (!item || item.kind !== 'cosmetic') throw badRequest('not a cosmetic', 'not_cosmetic');
    return this.db.transaction(() => {
      const own = this.db.inventory.get(userId, sku);
      if (!own || own.qty < 1) throw conflict('item not owned', 'not_owned');
      const cat = cosmeticCategory(sku);
      for (const r of this.db.inventory.list(userId)) {
        if (r.sku !== sku && r.equipped && cosmeticCategory(r.sku) === cat) this.db.inventory.put({ ...r, equipped: false });
      }
      this.db.inventory.put({ ...own, equipped: true });
      return this.list(userId);
    });
  }

  /** Unequips a cosmetic (used when the user switches back to the default skin). */
  unequipCategory(userId: string, category: string): void {
    for (const r of this.db.inventory.list(userId)) {
      if (r.equipped && cosmeticCategory(r.sku) === category) this.db.inventory.put({ ...r, equipped: false });
    }
  }
}
