import { CATALOG_BY_SKU, type BoostEffect, type CatalogItem } from '@tank/shared';
import { badRequest, notFound } from '../util/errors.js';

export type BoostItem = CatalogItem & { kind: 'boost'; effect: BoostEffect };

/** Catalog lookups. Prices and grants are always taken from the shared CATALOG, never from clients. */
export function getItem(sku: string): CatalogItem {
  const item = CATALOG_BY_SKU[sku];
  if (!item) throw notFound(`unknown sku ${sku}`, 'unknown_sku');
  return item;
}

export function isBoost(item: CatalogItem | undefined): item is BoostItem {
  return !!item && item.kind === 'boost' && typeof item.effect === 'string';
}

export function boostOrNull(sku: string): BoostItem | null {
  const item = CATALOG_BY_SKU[sku];
  return isBoost(item) ? item : null;
}

/** Price in the given soft currency; 400 when the item is not sold for it. */
export function priceOf(item: CatalogItem, currency: 'coins' | 'gems'): number {
  const p = item.prices[currency];
  if (typeof p !== 'number' || p <= 0) throw badRequest(`${item.sku} is not sold for ${currency}`, 'not_purchasable');
  return p;
}

/** USD price in cents; 400 when the item has no real-money price. */
export function usdPriceOf(item: CatalogItem): number {
  const p = item.prices.usd;
  if (typeof p !== 'number' || p <= 0) throw badRequest(`${item.sku} has no usd price`, 'not_purchasable');
  return p;
}

/** Whether an item may be transferred as a gift (consumables & cosmetics only). */
export function isGiftable(item: CatalogItem): boolean {
  return item.kind === 'boost' || item.kind === 'cosmetic';
}
