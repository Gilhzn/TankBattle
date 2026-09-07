import { type Snapshot } from '@tank/shared';
export interface Pos {
    x: number;
    y: number;
}
/** Distance above which tank positions are snapped instead of interpolated (a respawn/teleport). */
export declare const SNAP_DISTANCE: number;
/** Bullets never teleport (a new bullet gets a new id) but cover up to 2 tiles between snapshots. */
export declare const BULLET_SNAP_DISTANCE: number;
/**
 * Keeps the last N snapshots and produces smoothly interpolated entity positions
 * `delayTicks` behind the newest snapshot (0 for the local host = render the latest exactly).
 */
export declare class InterpBuffer {
    delayTicks: number;
    size: number;
    private frames;
    constructor(delayTicks?: number, size?: number);
    clear(): void;
    push(snap: Snapshot, nowMs?: number): void;
    get latestTick(): number;
    /** The tick to render at `nowMs`: advances between snapshots but never past the newest one. */
    renderTick(nowMs?: number): number;
    private bounds;
    private sample;
    tankPos(id: number, rt: number, fallback: Pos): Pos;
    bulletPos(id: number, rt: number, fallback: Pos): Pos;
}
//# sourceMappingURL=interp.d.ts.map