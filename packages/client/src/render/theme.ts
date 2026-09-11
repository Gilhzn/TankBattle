import { SKINS, type TankKind, type TankShape } from '@tank/shared';

/**
 * One light for the whole arena, from the north-west, and everything is lit by it: every bright
 * arris faces it, every shadow falls away from it. Consistency is what makes a flat canvas read as
 * solid — a scene where each object invents its own light never does, however well each is drawn.
 *
 * The camera looks straight down, so height is drawn as a chamfer: a raised block shows its top
 * face inset inside its own tile, with the four side faces filling the margin. That keeps the ink
 * exactly inside the tile the simulation collides against, which matters more in a game people
 * aim in than an extra few pixels of drama would.
 */
export const LIGHT = {
  /** Share of a tile taken by the side faces of a destructible panel. */
  panelHeight: 0.15,
  /** The bulkhead is the heavier of the two, and reads that way. */
  hullHeight: 0.22,
  /** How far a raised tile throws its contact shadow, as a share of a tile. */
  throw: 0.2,
  /**
   * Light spilling from a lit face onto the deck beside it. On a dark floor this reads far more
   * strongly than the shadow does, and the two together are what lift a block off the ground.
   */
  spill: 0.16,
  /** Brightness multipliers for the four side faces, north first, going clockwise. */
  faceN: 1.45,
  faceE: 0.62,
  faceS: 0.42,
  faceW: 1.16,
} as const;

export const COLORS = {
  bg: '#07090f',
  /**
   * The deck the arena is built on. Lifted well clear of the page background on purpose: a shadow
   * is only visible if the surface it falls on has somewhere to go, and against near-black every
   * contact shadow in the game was black on black and did nothing.
   */
  floor: '#151b28',
  floorDeep: '#0c111b',
  grid: 'rgba(94, 225, 255, 0.05)',
  cyan: '#5ee1ff',
  magenta: '#ff5ec4',
  lime: '#b6ff5e',
  amber: '#ffd166',
  white: '#ffffff',
  /**
   * Destructible cover is a graphite composite panel lit from inside: a dark plate whose seams
   * carry amber light. Warm still means "this breaks" and cool still means "this does not", so the
   * read a player needs in a tenth of a second survives, but the material is a panel and not
   * masonry.
   */
  panel: '#2b3040',
  panelFace: '#394054',
  panelLight: '#4a5265',
  panelDark: '#151a26',
  panelSeam: '#ff9d3c',
  panelSeamHot: '#ffd9a0',
  /** Structural bulkhead: one bevelled slab with a hazard stripe. Never breaks, never shot through. */
  hull: '#8b97ac',
  hullLight: '#dfe6f2',
  hullDark: '#394152',
  hullShadow: '#2c323f',
  hazard: '#f2c14e',
  /** Plasma channel: a dark trench with a live core running down it. */
  water: '#0a1424',
  waterLight: '#8f6bff',
  waterGlow: '#5ee1ff',
  plasmaCore: '#b49bff',
  plasmaEdge: '#2b2350',
  /**
   * Packed snow, not ice. A translucent pale blue read as *glass* — players saw a window, not a
   * surface, and had no reason to expect it to be slippery. These are opaque, matte and bright:
   * a solid drift you can see skid marks on.
   */
  snow: '#eef5fb',
  snowShade: '#c3d6e8',
  snowDeep: '#93aec7',
  snowTrack: '#7e9cba',
  /** Canopy: translucent crystal shards a tank can drive under and be hidden by. */
  trees: '#1f9a86',
  treesLight: '#68f2d2',
  treesDark: '#062f2c',
  treesShard: '#0e6b62',
  /** The reactor core each side defends. */
  base: '#5ee1ff',
  baseLight: '#eafcff',
  baseDark: '#0d3d55',
  bulletPlayer: '#fff7d6',
  bulletEnemy: '#ffb4e6',
  /** Hostile optic lens shared by every AI chassis. */
  enemyEye: '#ff3b30',
} as const;

export interface Palette {
  primary: string;
  secondary: string;
  glow: string;
  /** Chassis silhouette. Missing = 'standard' (older callers). */
  shape?: TankShape;
}

/**
 * AI palettes. Deliberately a *separate colour family* from the player skins: desaturated
 * hostile metal — gunmetal, sand-rust, oxide and sickly olive — so no enemy ever reads as a
 * team colour. Player skins own the saturated hues (gold / cyan / magenta / violet).
 */
const ENEMY_PALETTES: Record<Exclude<TankKind, 'player'>, Palette> = {
  basic: { primary: '#8c96a8', secondary: '#333a47', glow: '#aeb8c8', shape: 'grunt' },
  // Khaki *ash*, not sand: the earlier tone sat in the same hue family as the gold player skin and
  // the two read alike at tank size. Crushing lightness and saturation keeps the scout warm-metal
  // while putting ~30 points of lightness and ~80 of saturation between it and #ffd166.
  fast: { primary: '#7a6f57', secondary: '#2b2618', glow: '#c2b08a', shape: 'scout' },
  power: { primary: '#b5563a', secondary: '#511d13', glow: '#dd8f6f', shape: 'brute' },
  armor: { primary: '#7f9440', secondary: '#2f3a15', glow: '#b3c977', shape: 'bulwark' },
};

/** Slot -> default skin. A player without a custom skin always wears their slot's team colour. */
const ALLY_SKINS = ['default', 'p2', 'p3', 'p4'];

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const v = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
export function rgba(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}
/** Scales a colour's brightness, clamped. `f > 1` lights a face, `f < 1` puts it in shade. */
export function shade(hex: string, f: number): string {
  const c = hexToRgb(hex).map((v) => Math.max(0, Math.min(255, Math.round(v * f))));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
export function mixHex(a: string, b: string, t: number): string {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  const c = A.map((v, i) => Math.round(v + (B[i] - v) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Palette for a tank: player skin (slot fallback p2..p4), enemy kind, armor tinted redder as HP drops. */
export function tankPalette(kind: TankKind, owner: number, skin: string, hp: number, maxHp: number): Palette {
  if (kind === 'player') {
    const custom = skin && skin !== 'default' && SKINS[skin];
    const key = custom ? skin : ALLY_SKINS[Math.max(0, Math.min(3, owner))];
    return SKINS[key] ?? SKINS.default;
  }
  const p = ENEMY_PALETTES[kind];
  if (kind === 'armor' && maxHp > 1) {
    const damage = 1 - Math.max(0, Math.min(1, (hp - 1) / (maxHp - 1)));
    return {
      primary: mixHex(p.primary, '#b8342a', damage),
      secondary: mixHex(p.secondary, '#4a0f0a', damage),
      glow: mixHex(p.glow, '#e08a80', damage),
      shape: p.shape,
    };
  }
  return p;
}

export function paletteKey(p: Palette): string {
  return `${p.primary}${p.secondary}${p.shape ?? 'standard'}`;
}
