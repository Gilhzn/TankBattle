import { SKINS, type TankKind } from '@tank/shared';

export const COLORS = {
  bg: '#07090f',
  grid: 'rgba(94, 225, 255, 0.05)',
  cyan: '#5ee1ff',
  magenta: '#ff5ec4',
  lime: '#b6ff5e',
  amber: '#ffd166',
  white: '#ffffff',
  brick: '#8a3a2f',
  brickLight: '#c85a45',
  brickDark: '#4a1c16',
  mortar: '#1a0c0c',
  steel: '#8f9bb0',
  steelLight: '#e2e8f4',
  steelDark: '#3d4557',
  water: '#0b3a66',
  waterLight: '#2f8fd6',
  waterGlow: '#5ee1ff',
  ice: '#9fd8ff',
  iceDark: '#3b6d9c',
  trees: '#1f9a4a',
  treesLight: '#5ee97a',
  treesDark: '#0c3f22',
  base: '#ffd166',
  baseDark: '#7a5a12',
  bulletPlayer: '#fff7d6',
  bulletEnemy: '#ffb4e6',
} as const;

export interface Palette {
  primary: string;
  secondary: string;
  glow: string;
}

const ENEMY_PALETTES: Record<Exclude<TankKind, 'player'>, Palette> = {
  basic: { primary: '#c3cad6', secondary: '#6b7484', glow: '#e6ebf3' },
  fast: { primary: '#6fd8e8', secondary: '#2a7f95', glow: '#a9f2ff' },
  power: { primary: '#ff9a3d', secondary: '#b5501a', glow: '#ffc88a' },
  armor: { primary: '#63d97a', secondary: '#237a3b', glow: '#a8ffb8' },
};

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
    return { primary: mixHex(p.primary, '#ff4a4a', damage), secondary: mixHex(p.secondary, '#8a1010', damage), glow: mixHex(p.glow, '#ff9a9a', damage) };
  }
  return p;
}

export function paletteKey(p: Palette): string {
  return `${p.primary}${p.secondary}`;
}
