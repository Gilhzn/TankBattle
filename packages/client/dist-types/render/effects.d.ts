import type { Ctx2D } from './sprites.js';
/** Object-pooled particles + shockwave rings + score popups + screen shake. All positions are in logical field units. */
export declare class Effects {
    private reducedMotion;
    private pool;
    private rings;
    private popups;
    private shakePower;
    private shakeT;
    flash: number;
    constructor(reducedMotion: () => boolean);
    clear(): void;
    private spawn;
    private count;
    brick(x: number, y: number): void;
    sparks(x: number, y: number, color?: string): void;
    explosion(x: number, y: number, big: boolean): void;
    ring(x: number, y: number, radius: number, life: number, color: string, width: number): void;
    spawnRing(x: number, y: number, color: string): void;
    pickup(x: number, y: number, color: string): void;
    popup(x: number, y: number, text: string, color?: string): void;
    shake(power: number): void;
    /** Current shake offset in device px (≤ 4 px at full power). */
    shakeOffset(): [number, number];
    update(dt: number): void;
    /** Draws in device px; `scale` converts logical units. */
    draw(ctx: Ctx2D, scale: number, fontPx: number): void;
}
//# sourceMappingURL=effects.d.ts.map