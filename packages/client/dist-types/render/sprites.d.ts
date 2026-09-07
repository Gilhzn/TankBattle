import { type PowerUpKind, type TileId } from '@tank/shared';
import { type Palette } from './theme.js';
export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
export declare function makeCanvas(w: number, h: number): AnyCanvas;
export declare function ctxOf(c: AnyCanvas): Ctx2D;
/** Keyed cache of pre-rendered sprites (OffscreenCanvas when available). Glows are baked here, never blurred per frame. */
export declare class SpriteCache {
    private map;
    get(key: string, w: number, h: number, draw: (ctx: Ctx2D, w: number, h: number) => void): AnyCanvas;
    clear(): void;
    get size(): number;
}
export declare function roundRect(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number): void;
/** Radial glow disc, drawn once per (color, size). */
export declare function drawGlow(ctx: Ctx2D, size: number, color: string, inner?: number): void;
export interface TankSpriteOptions {
    palette: Palette;
    frame: number;
    tier: number;
    isPlayer: boolean;
}
/**
 * Draws a tank facing UP into a (size x size) canvas. `size` includes a 25 % glow margin around the body.
 * Body occupies the centre 80 %.
 */
export declare function drawTankSprite(ctx: Ctx2D, size: number, o: TankSpriteOptions): void;
export declare function drawBulletSprite(ctx: Ctx2D, size: number, color: string, glow: string): void;
/** Static tiles. `s` is the tile size in device px. */
export declare function drawTile(ctx: Ctx2D, tile: TileId, x: number, y: number, s: number, tx: number, ty: number): void;
/** The base emblem occupies a 2x2 tile block. `s` is the block size in device px. */
export declare function drawBase(ctx: Ctx2D, x: number, y: number, s: number, dead: boolean): void;
export declare const POWERUP_COLORS: Record<PowerUpKind, string>;
/** Vector glyph for a power-up kind, centred in a (size x size) box. */
export declare function drawPowerUpGlyph(ctx: Ctx2D, kind: PowerUpKind, size: number, color: string): void;
//# sourceMappingURL=sprites.d.ts.map