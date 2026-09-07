import { type TankKind } from '@tank/shared';
export declare const COLORS: {
    readonly bg: "#07090f";
    readonly grid: "rgba(94, 225, 255, 0.05)";
    readonly cyan: "#5ee1ff";
    readonly magenta: "#ff5ec4";
    readonly lime: "#b6ff5e";
    readonly amber: "#ffd166";
    readonly white: "#ffffff";
    readonly brick: "#8a3a2f";
    readonly brickLight: "#c85a45";
    readonly brickDark: "#4a1c16";
    readonly mortar: "#1a0c0c";
    readonly steel: "#8f9bb0";
    readonly steelLight: "#e2e8f4";
    readonly steelDark: "#3d4557";
    readonly water: "#0b3a66";
    readonly waterLight: "#2f8fd6";
    readonly waterGlow: "#5ee1ff";
    readonly ice: "#9fd8ff";
    readonly iceDark: "#3b6d9c";
    readonly trees: "#1f9a4a";
    readonly treesLight: "#5ee97a";
    readonly treesDark: "#0c3f22";
    readonly base: "#ffd166";
    readonly baseDark: "#7a5a12";
    readonly bulletPlayer: "#fff7d6";
    readonly bulletEnemy: "#ffb4e6";
};
export interface Palette {
    primary: string;
    secondary: string;
    glow: string;
}
export declare function hexToRgb(hex: string): [number, number, number];
export declare function rgba(hex: string, a: number): string;
export declare function mixHex(a: string, b: string, t: number): string;
/** Palette for a tank: player skin (slot fallback p2..p4), enemy kind, armor tinted redder as HP drops. */
export declare function tankPalette(kind: TankKind, owner: number, skin: string, hp: number, maxHp: number): Palette;
export declare function paletteKey(p: Palette): string;
//# sourceMappingURL=theme.d.ts.map