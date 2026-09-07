import type { Input, MatchResult, Snapshot, TickEvent } from '@tank/shared';
export type MetaEvent = {
    type: 'itemResult';
    sku: string;
    ok: boolean;
    error?: string;
    inventory?: Record<string, number>;
} | {
    type: 'gameOver';
    reason: string;
    results: MatchResult[];
} | {
    type: 'connection';
    state: 'connected' | 'reconnecting' | 'closed';
    attempt?: number;
} | {
    type: 'rtt';
    ms: number;
} | {
    type: 'paused';
    paused: boolean;
} | {
    type: 'error';
    code: string;
    message: string;
};
/** Abstraction between the game view and where the simulation runs (in-browser or on the server). */
export interface GameTransport {
    readonly mode: 'local' | 'online';
    /** Slot of the local player in `snapshot.players`. */
    readonly mySlot: number;
    sendInput(input: Input): void;
    useItem(sku: string): void;
    onSnapshot(cb: (snap: Snapshot) => void): () => void;
    onEvent(cb: (events: TickEvent[], tick: number) => void): () => void;
    onMeta(cb: (ev: MetaEvent) => void): () => void;
    /** Consumables still available in this match, by sku. */
    itemCounts(): Record<string, number>;
    pause(): void;
    resume(): void;
    readonly paused: boolean;
    readonly rtt: number;
    stop(): void;
}
export declare class Emitter<T> {
    private set;
    on(cb: (v: T) => void): () => void;
    emit(v: T): void;
    clear(): void;
}
//# sourceMappingURL=transport.d.ts.map