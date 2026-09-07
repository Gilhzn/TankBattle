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

export const SKINS: Record<string, { name: string; primary: string; secondary: string; glow: string }> = {
  default: { name: 'Standard', primary: '#ffd166', secondary: '#f4a261', glow: '#ffe08a' },
  skin_neon_viper: { name: 'Neon Viper', primary: '#7cff4a', secondary: '#1c9c3a', glow: '#b8ff8a' },
  skin_gold_ingot: { name: 'Gold Ingot', primary: '#ffcc33', secondary: '#c98a00', glow: '#fff1a8' },
  skin_void: { name: 'Void Walker', primary: '#8a5cff', secondary: '#3a1c8c', glow: '#c7aaff' },
  skin_ember: { name: 'Ember', primary: '#ff7a3d', secondary: '#c0341a', glow: '#ffb38a' },
  p2: { name: 'Ally', primary: '#5ee1ff', secondary: '#1f8bb3', glow: '#a8f0ff' },
  p3: { name: 'Ally', primary: '#ff5ec4', secondary: '#a8177a', glow: '#ffa8e2' },
  p4: { name: 'Ally', primary: '#b6ff5e', secondary: '#5aa81e', glow: '#e0ffb0' },
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
