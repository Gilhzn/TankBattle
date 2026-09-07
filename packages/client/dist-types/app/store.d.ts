import type { BattlePassDTO, DailyDTO, InventoryDTO, StatsDTO, UserDTO, WalletDTO } from './api.js';
/** Minimal reactive store: get / set (patch or updater) / subscribe. */
export declare class Store<T extends object> {
    private state;
    private listeners;
    constructor(state: T);
    get(): T;
    set(patch: Partial<T> | ((prev: T) => Partial<T>)): void;
    subscribe(listener: (state: T, prev: T) => void): () => void;
    /** Subscribe to a derived value; fires only when it changes. */
    select<V>(selector: (s: T) => V, listener: (v: V) => void): () => void;
}
export interface Toast {
    id: number;
    text: string;
    kind: 'info' | 'error' | 'success';
    action?: {
        label: string;
        run: () => void;
    };
}
export interface AppState {
    screen: string;
    booted: boolean;
    online: boolean;
    token: string | null;
    user: UserDTO | null;
    wallet: WalletDTO;
    inventory: InventoryDTO;
    battlepass: BattlePassDTO | null;
    daily: DailyDTO | null;
    stats: StatsDTO | null;
    pendingGifts: number;
    provider: 'mock' | 'stripe';
    toasts: Toast[];
    updateAvailable: boolean;
}
export declare const app: Store<AppState>;
export declare function toast(text: string, kind?: Toast['kind'], action?: Toast['action'], ttl?: number): void;
export declare function dismissToast(id: number): void;
export declare function ownedQty(sku: string): number;
//# sourceMappingURL=store.d.ts.map