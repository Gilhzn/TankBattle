import { type ClientMessage, type GameMode, type Input, type RoomStateMessage, type ServerMessage, type Snapshot, type TickEvent } from '@tank/shared';
import { Emitter, type GameTransport, type MetaEvent } from './transport.js';
export type WsState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';
export interface GameStartInfo {
    seed: number;
    stage: number;
    snapshot: Snapshot;
    yourSlot: number;
}
/**
 * WebSocket client for /ws: hello/welcome, room ops, input + heartbeat, snapshots,
 * reconnect with exponential backoff + jitter and `resume`, RTT pings.
 */
export declare class WsClient implements GameTransport {
    readonly mode: "online";
    mySlot: number;
    rtt: number;
    paused: boolean;
    state: WsState;
    room: RoomStateMessage | null;
    playerId: string;
    name: string;
    lastGameStart: GameStartInfo | null;
    attempt: number;
    private ws;
    private intentionalClose;
    private reconnectTimer;
    private pingTimer;
    private heartbeatTimer;
    private seq;
    private lastInput;
    private lastInputSent;
    private welcomeWaiters;
    private itemCountsMap;
    private nonce;
    private pendingItems;
    readonly snapshots: Emitter<Snapshot>;
    readonly events: Emitter<{
        events: TickEvent[];
        tick: number;
    }>;
    readonly meta: Emitter<MetaEvent>;
    readonly server: Emitter<ServerMessage>;
    readonly stateChanged: Emitter<WsState>;
    private setState;
    get connected(): boolean;
    /** Opens the socket (if needed) and resolves once `welcome` arrives. */
    connect(): Promise<void>;
    private open;
    private scheduleReconnect;
    private failWaiters;
    private handle;
    private loadoutCounts;
    private startTimers;
    private stopTimers;
    send(msg: ClientMessage): boolean;
    createRoom(mode: GameMode, isPrivate: boolean, loadout: string[]): void;
    joinRoom(code: string, loadout: string[]): void;
    quickPlay(mode: GameMode, loadout: string[]): void;
    leaveRoom(): void;
    setReady(ready: boolean): void;
    setLoadout(loadout: string[]): void;
    startGame(): void;
    chat(text: string): void;
    sendInput(input: Input): void;
    private pushInput;
    useItem(sku: string): void;
    itemCounts(): Record<string, number>;
    onSnapshot(cb: (snap: Snapshot) => void): () => void;
    onEvent(cb: (events: TickEvent[], tick: number) => void): () => void;
    onMeta(cb: (ev: MetaEvent) => void): () => void;
    pause(): void;
    resume(): void;
    /** For the GameTransport contract: the socket outlives a match, so the view only detaches. */
    stop(): void;
    close(): void;
}
export declare const ws: WsClient;
//# sourceMappingURL=wsClient.d.ts.map