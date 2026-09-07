import { type BoostEffect, type GameMode, type GameState, type Input, type PlayerInit, type Snapshot, type TickEvent } from '@tank/shared';
import { type GameTransport, type MetaEvent } from './transport.js';
export interface LocalHostOptions {
    seed: number;
    stage: number;
    players: PlayerInit[];
    mode?: GameMode;
    /** Effects the server pre-authorised for this solo match (from /api/solo/start). Offline: none. */
    boosts?: BoostEffect[];
}
/**
 * Runs the shared deterministic simulation in the browser at a fixed 30 Hz accumulator.
 * Records inputs/commands so the server can verify the replay (`/api/solo/result`).
 */
export declare class LocalGameHost implements GameTransport {
    readonly mode: "local";
    readonly mySlot = 0;
    readonly rtt = 0;
    readonly state: GameState;
    readonly inputs: Array<Array<[number, number]>>;
    readonly commands: Array<[number, BoostEffect]>;
    paused: boolean;
    private input;
    private pending;
    private available;
    private snapshots;
    private events;
    private meta;
    private timer;
    private last;
    private acc;
    private stopped;
    private stageName;
    constructor(opts: LocalHostOptions);
    start(): void;
    private onVisibility;
    private loop;
    private tick;
    private emitSnapshot;
    sendInput(input: Input): void;
    useItem(sku: string): void;
    itemCounts(): Record<string, number>;
    onSnapshot(cb: (snap: Snapshot) => void): () => void;
    onEvent(cb: (events: TickEvent[], tick: number) => void): () => void;
    onMeta(cb: (ev: MetaEvent) => void): () => void;
    pause(): void;
    resume(): void;
    stop(): void;
}
//# sourceMappingURL=localHost.d.ts.map