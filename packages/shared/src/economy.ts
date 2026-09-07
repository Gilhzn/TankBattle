export type Currency = 'coins' | 'gems' | 'usd';
export type ItemKind = 'currency' | 'boost' | 'cosmetic' | 'pass' | 'bundle';

export interface CatalogItem {
  sku: string;
  kind: ItemKind;
  name: string;
  description: string;
  icon: string;
  /** Prices in different currencies; usd is in cents. */
  prices: Partial<Record<Currency, number>>;
  /** Grants applied on purchase (for currency packs / bundles). */
  grants?: { coins?: number; gems?: number; items?: Record<string, number> };
  /** Max uses per match (boosts) */
  maxPerMatch?: number;
  /** Whether the boost is applied automatically at match start (vs. used on demand). */
  atStart?: boolean;
  /** Command executed by the server when the boost is consumed in a match. */
  effect?: 'grenade' | 'clock' | 'shield' | 'life' | 'star' | 'revive';
  oneTime?: boolean;
  tag?: 'best' | 'popular' | 'new';
}

export const CATALOG: CatalogItem[] = [
  { sku: 'gems_100', kind: 'currency', name: 'Pouch of Gems', description: '100 gems', icon: '💎', prices: { usd: 99 }, grants: { gems: 100 } },
  { sku: 'gems_550', kind: 'currency', name: 'Crate of Gems', description: '500 + 50 bonus gems', icon: '💎', prices: { usd: 499 }, grants: { gems: 550 }, tag: 'popular' },
  { sku: 'gems_1200', kind: 'currency', name: 'Vault of Gems', description: '1000 + 200 bonus gems', icon: '💎', prices: { usd: 999 }, grants: { gems: 1200 }, tag: 'best' },
  { sku: 'starter_pack', kind: 'bundle', name: 'Starter Pack', description: '300 gems, Ember skin and 3 shields', icon: '🎁', prices: { usd: 299 }, grants: { gems: 300, items: { skin_ember: 1, boost_shield: 3 } }, oneTime: true, tag: 'new' },
  { sku: 'boost_life', kind: 'boost', name: 'Extra Life', description: '+1 life at match start', icon: '❤️', prices: { coins: 250, gems: 25 }, maxPerMatch: 1, atStart: true, effect: 'life' },
  { sku: 'boost_shield', kind: 'boost', name: 'Start Shield', description: '10 s of invulnerability at match start', icon: '🛡️', prices: { coins: 150, gems: 15 }, maxPerMatch: 1, atStart: true, effect: 'shield' },
  { sku: 'boost_star', kind: 'boost', name: 'Star Start', description: 'Begin with a tier-1 cannon', icon: '⭐', prices: { coins: 200, gems: 20 }, maxPerMatch: 1, atStart: true, effect: 'star' },
  { sku: 'boost_grenade', kind: 'boost', name: 'Grenade', description: 'Wipe all enemies on screen (use in match)', icon: '💣', prices: { coins: 300, gems: 30 }, maxPerMatch: 2, effect: 'grenade' },
  { sku: 'boost_clock', kind: 'boost', name: 'Time Freeze', description: 'Freeze enemies for 10 s (use in match)', icon: '⏱️', prices: { coins: 250, gems: 25 }, maxPerMatch: 1, effect: 'clock' },
  { sku: 'revive_token', kind: 'boost', name: 'Revive Token', description: 'Continue once after losing all lives', icon: '💫', prices: { gems: 50 }, maxPerMatch: 1, effect: 'revive' },
  { sku: 'skin_neon_viper', kind: 'cosmetic', name: 'Neon Viper', description: 'Acid-green plating with a venom trail', icon: '🐍', prices: { gems: 300 } },
  { sku: 'skin_gold_ingot', kind: 'cosmetic', name: 'Gold Ingot', description: 'Gilded hull, for the flex', icon: '🥇', prices: { gems: 800 }, tag: 'popular' },
  { sku: 'skin_void', kind: 'cosmetic', name: 'Void Walker', description: 'Ultraviolet stealth chassis', icon: '🌌', prices: { gems: 600 } },
  { sku: 'skin_ember', kind: 'cosmetic', name: 'Ember', description: 'Molten orange plating', icon: '🔥', prices: { gems: 400 } },
  { sku: 'trail_plasma', kind: 'cosmetic', name: 'Plasma Trail', description: 'Bullets leave a plasma wake', icon: '✨', prices: { gems: 250 } },
  { sku: 'battlepass_premium', kind: 'pass', name: 'Premium Battle Pass', description: 'Unlock the premium reward track this season', icon: '🎫', prices: { gems: 950 }, oneTime: true, tag: 'best' },
];

export const CATALOG_BY_SKU: Record<string, CatalogItem> = Object.fromEntries(CATALOG.map((i) => [i.sku, i]));

/**
 * Chassis silhouette used by the sprite factory. Purely cosmetic — the simulation hitbox is always
 * the same 16x16 logical box. Pricier skins get more elaborate outlines:
 * standard (free) < stealth (300) < heavy (400) < phantom (600) < elite (800).
 * The `grunt`/`scout`/`brute`/`bulwark` shapes are reserved for AI tanks so enemies never share a
 * silhouette with a player chassis.
 */
export type TankShape =
  | 'standard'
  | 'heavy'
  | 'stealth'
  | 'phantom'
  | 'elite'
  | 'grunt'
  | 'scout'
  | 'brute'
  | 'bulwark';

export interface SkinDef {
  name: string;
  primary: string;
  secondary: string;
  glow: string;
  shape: TankShape;
}

/**
 * Player chassis palettes. These are deliberately kept to saturated "team" hues (gold, cyan,
 * magenta, violet, acid green) — the AI palettes in the client live in a separate, desaturated
 * "hostile metal" family so a player is never mistaken for an enemy.
 */
export const SKINS: Record<string, SkinDef> = {
  default: { name: 'Standard', primary: '#ffd166', secondary: '#e08a2e', glow: '#ffe08a', shape: 'standard' },
  skin_neon_viper: { name: 'Neon Viper', primary: '#8dff3a', secondary: '#17a83c', glow: '#c6ff8a', shape: 'stealth' },
  skin_gold_ingot: { name: 'Gold Ingot', primary: '#ffcc33', secondary: '#b87800', glow: '#fff1a8', shape: 'elite' },
  skin_void: { name: 'Void Walker', primary: '#a274ff', secondary: '#3a1c8c', glow: '#d3bcff', shape: 'phantom' },
  skin_ember: { name: 'Ember', primary: '#ff7a3d', secondary: '#b52d12', glow: '#ffb38a', shape: 'heavy' },
  p2: { name: 'Ally', primary: '#3fe0ff', secondary: '#0d7fa8', glow: '#a8f0ff', shape: 'standard' },
  p3: { name: 'Ally', primary: '#ff4fc0', secondary: '#a8177a', glow: '#ffa8e2', shape: 'standard' },
  p4: { name: 'Ally', primary: '#b06bff', secondary: '#5c22b8', glow: '#dcb8ff', shape: 'standard' },
};

export interface BattlePassTier {
  tier: number;
  xp: number;
  free: { coins?: number; gems?: number; items?: Record<string, number> } | null;
  premium: { coins?: number; gems?: number; items?: Record<string, number> } | null;
}

export const BATTLEPASS_SEASON_DAYS = 30;
export const BATTLEPASS_TIERS: BattlePassTier[] = Array.from({ length: 30 }, (_, i): BattlePassTier => {
  const tier = i + 1;
  const xp = tier * 400 + Math.floor((tier * tier) / 2) * 20;
  const free: BattlePassTier['free'] =
    tier % 10 === 0 ? { gems: 20 } : tier % 5 === 0 ? { items: { boost_shield: 1 } } : { coins: 60 + tier * 10 };
  const premium: BattlePassTier['premium'] =
    tier === 30
      ? { items: { skin_void: 1 } }
      : tier === 20
        ? { items: { trail_plasma: 1 } }
        : tier === 10
          ? { items: { skin_ember: 1 } }
          : tier % 3 === 0
            ? { gems: 60 }
            : tier % 3 === 1
              ? { items: { boost_grenade: 1 } }
              : { coins: 150 + tier * 15 };
  return { tier, xp, free, premium };
});

export const DAILY_REWARDS: Array<{ coins?: number; gems?: number; items?: Record<string, number> }> = [
  { coins: 100 },
  { coins: 150 },
  { items: { boost_shield: 1 } },
  { coins: 200 },
  { items: { boost_grenade: 1 } },
  { coins: 300 },
  { gems: 30 },
];

export const REWARD_RULES = {
  coinsPerScore: 0.1,
  stageClearBonus: 50,
  coopAssistBonus: 25,
  xpPerScore: 0.02,
  xpPerStage: 100,
  soloDailyCoinCap: 1000,
  adMinSeconds: 15,
  adMaxPerDay: 5,
  adMenuCoins: 50,
  giftsPerDay: 10,
} as const;

export function matchRewards(score: number, stagesCleared: number, kills: number, coop: boolean): { coins: number; xp: number } {
  const coins = Math.floor(score * REWARD_RULES.coinsPerScore) + stagesCleared * REWARD_RULES.stageClearBonus + (coop ? kills * 2 : 0);
  const xp = Math.floor(score * REWARD_RULES.xpPerScore) + stagesCleared * REWARD_RULES.xpPerStage + kills * 3;
  return { coins, xp };
}
