import { type PowerUpKind, type ViewState } from '@tank/shared';
import type { InterpBuffer } from '../game/interp.js';
import type { Effects } from './effects.js';
export interface RenderOptions {
    mySlot: number;
    reducedMotion: boolean;
    powerUpLabel: (kind: PowerUpKind) => string;
}
/** Canvas 2D renderer. Logical units are simulation sub-pixels (FIELD = 1664) mapped by `scale`. */
export declare class Renderer {
    readonly canvas: HTMLCanvasElement;
    private ctx;
    private sprites;
    private tileLayer;
    private treesLayer;
    private tilesCopy;
    private tilesValid;
    private waterTiles;
    private hasTrees;
    size: number;
    scale: number;
    dpr: number;
    constructor(canvas: HTMLCanvasElement);
    resize(cssSize: number): void;
    /** Force the tile layer to rebuild (e.g. after a full snapshot). */
    invalidateTiles(): void;
    private tilesChanged;
    private rebuildTiles;
    private drawWater;
    private tankSprite;
    private drawTanks;
    private drawSpawnStar;
    private drawShield;
    private drawBullets;
    private drawPowerUp;
    draw(view: ViewState, interp: InterpBuffer, effects: Effects, time: number, opts: RenderOptions): void;
}
//# sourceMappingURL=renderer.d.ts.map