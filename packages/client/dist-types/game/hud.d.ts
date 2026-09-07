import { type ViewState } from '@tank/shared';
export interface HudCallbacks {
    onPause: () => void;
    onUseItem: (sku: string) => void;
}
export interface HudInfo {
    rtt: number | null;
    items: Record<string, number>;
    mySlot: number;
    mode: 'local' | 'online';
    paused: boolean;
}
/** DOM overlay: stage, enemies remaining, per-player lives + score, effect timers, RTT, pause, consumables. */
export declare class Hud {
    private cb;
    readonly el: HTMLElement;
    private stageEl;
    private enemiesEl;
    private livesEl;
    private effectsEl;
    private rttEl;
    private timeEl;
    private pauseBtn;
    private itemsEl;
    private itemButtons;
    private last;
    constructor(cb: HudCallbacks);
    update(view: ViewState, info: HudInfo): void;
}
//# sourceMappingURL=hud.d.ts.map