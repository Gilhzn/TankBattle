import { type MatchResult, type Snapshot, type ViewState } from '@tank/shared';
import type { GameTransport } from '../net/transport.js';
export interface GameOverInfo {
    reason: string;
    results?: MatchResult[];
    view: ViewState;
}
export interface GameViewOptions {
    transport: GameTransport;
    onGameOver: (info: GameOverInfo) => void;
    onQuit: () => void;
    /** Optional: the local host can be asked to revive (consumes a token). */
    canRevive?: () => boolean;
}
declare global {
    interface Window {
        __tank?: {
            view: ViewState;
            tick: number;
            mode: 'local' | 'online';
            screen: string;
            input: (dir: number, fire: boolean) => void;
        };
    }
}
export declare class GameView {
    private opts;
    readonly el: HTMLElement;
    readonly view: ViewState;
    private hasFull;
    private interp;
    private renderer;
    private effects;
    private hud;
    private input;
    private canvas;
    private fieldWrap;
    private bannerLayer;
    private pauseOverlay;
    private touchLayer;
    private raf;
    private lastFrame;
    private running;
    private unsubs;
    private ro;
    private gameOverTimer;
    private gameOverSent;
    private stageName;
    private bannerTimer;
    private itemCounts;
    constructor(opts: GameViewOptions);
    get paused(): boolean;
    mount(container: HTMLElement): void;
    private layout;
    private onVisibility;
    private frame;
    /** Feed a snapshot directly (used for the `gameStart` snapshot that arrives before the view mounts). */
    pushSnapshot(snap: Snapshot): void;
    private onSnapshot;
    private onEvents;
    private onEvent;
    private handleGameOver;
    private showRevivePrompt;
    private finish;
    private onMeta;
    private useItem;
    private banner;
    private clearBanner;
    pause(): void;
    resume(): void;
    togglePause(): void;
    destroy(): void;
}
//# sourceMappingURL=gameView.d.ts.map