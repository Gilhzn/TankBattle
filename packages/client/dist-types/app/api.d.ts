import type { BattlePassTier, BoostEffect, CatalogItem } from '@tank/shared';
export interface UserDTO {
    id: string;
    nickname: string;
    skin: string;
    createdAt: number;
    settings: Record<string, unknown>;
}
export interface WalletDTO {
    coins: number;
    gems: number;
}
export type InventoryDTO = Record<string, {
    qty: number;
    equipped: boolean;
}>;
export interface DailyDTO {
    streak: number;
    day: number;
    claimable: boolean;
    nextClaimAt: number;
    rewards: Array<{
        coins?: number;
        gems?: number;
        items?: Record<string, number>;
    }>;
}
export interface BattlePassDTO {
    season: number;
    endsAt: number;
    xp: number;
    tier: number;
    premium: boolean;
    claimedFree: number[];
    claimedPremium: number[];
    tiers: BattlePassTier[];
}
export interface StatsDTO {
    matches: number;
    bestScore: number;
    bestStage: number;
    kills: number;
}
export interface GiftDTO {
    id: string;
    fromName: string;
    toName: string;
    sku: string;
    qty: number;
    message: string;
    status: 'pending' | 'claimed';
    createdAt: number;
}
export interface OrderDTO {
    id: string;
    sku: string;
    provider: 'mock' | 'stripe';
    status: 'pending' | 'completed' | 'failed';
    amountCents: number;
    currency: 'usd';
}
export interface LeaderEntry {
    rank: number;
    name: string;
    score: number;
    stage: number;
    mode: string;
}
export interface MeResponse {
    user: UserDTO;
    wallet: WalletDTO;
    inventory: InventoryDTO;
    battlepass: BattlePassDTO;
    daily: DailyDTO;
    stats: StatsDTO;
    pendingGifts: number;
    provider: 'mock' | 'stripe';
}
export interface SoloStartResponse {
    soloId: string;
    seed: number;
    stage: number;
    boosts: BoostEffect[];
    inventory: InventoryDTO;
}
export interface SoloResultBody {
    soloId: string;
    inputs: Array<Array<[number, number]>>;
    commands: Array<[number, BoostEffect]>;
    claimedScore: number;
    claimedStage: number;
}
export interface SoloResultResponse {
    verified: boolean;
    score: number;
    stage: number;
    coins: number;
    xp: number;
    wallet: WalletDTO;
    battlepass: BattlePassDTO;
}
export declare class ApiError extends Error {
    status: number;
    code: string;
    constructor(status: number, code: string, message: string);
}
export declare function deviceToken(): string;
export declare function getToken(): string | null;
export declare function api<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown, opts?: {
    auth?: boolean;
    timeoutMs?: number;
}): Promise<T>;
/** Guest auth + /api/me. Never throws; leaves the app in offline mode when the server is unreachable. */
export declare function boot(): Promise<void>;
export declare function refreshMe(): Promise<MeResponse>;
/** Refresh silently after an economy action (errors are swallowed). */
export declare function refreshQuietly(): Promise<void>;
export declare function applyWallet(wallet?: WalletDTO, inventory?: InventoryDTO): void;
export declare const Api: {
    patchMe: (body: {
        nickname?: string;
        skin?: string;
        settings?: Record<string, unknown>;
    }) => Promise<{
        user: UserDTO;
    }>;
    catalog: () => Promise<{
        items: CatalogItem[];
        ownedOneTime: string[];
        provider: "mock" | "stripe";
    }>;
    purchase: (sku: string, qty: number, currency: "coins" | "gems") => Promise<{
        wallet: WalletDTO;
        inventory: InventoryDTO;
    }>;
    checkout: (sku: string) => Promise<{
        orderId: string;
        provider: "mock" | "stripe";
        redirectUrl?: string;
        clientSecret?: string;
    }>;
    mockComplete: (orderId: string) => Promise<{
        order: OrderDTO;
        wallet: WalletDTO;
        inventory: InventoryDTO;
    }>;
    orders: () => Promise<{
        orders: OrderDTO[];
    }>;
    inventory: () => Promise<{
        inventory: InventoryDTO;
    }>;
    equip: (sku: string) => Promise<{
        user: UserDTO;
        inventory: InventoryDTO;
    }>;
    daily: () => Promise<DailyDTO>;
    dailyClaim: () => Promise<{
        reward: DailyDTO["rewards"][number];
        wallet: WalletDTO;
        inventory: InventoryDTO;
        daily: DailyDTO;
    }>;
    adStart: (placement: "results" | "menu") => Promise<{
        adSessionId: string;
        minSeconds: number;
        remainingToday: number;
    }>;
    adComplete: (adSessionId: string, placement: "results" | "menu") => Promise<{
        coins: number;
        wallet: WalletDTO;
    }>;
    battlepass: () => Promise<BattlePassDTO>;
    bpClaim: (tier: number, track: "free" | "premium") => Promise<{
        wallet: WalletDTO;
        inventory: InventoryDTO;
        battlepass: BattlePassDTO;
    }>;
    bpPremium: () => Promise<{
        wallet: WalletDTO;
        battlepass: BattlePassDTO;
    }>;
    giftSend: (to: string, sku: string, qty: number, message?: string) => Promise<{
        gift: GiftDTO;
        inventory: InventoryDTO;
        wallet: WalletDTO;
    }>;
    giftInbox: () => Promise<{
        gifts: GiftDTO[];
    }>;
    giftClaim: (id: string) => Promise<{
        wallet: WalletDTO;
        inventory: InventoryDTO;
    }>;
    soloStart: (loadout: string[], stage?: number) => Promise<SoloStartResponse>;
    soloResult: (body: SoloResultBody) => Promise<SoloResultResponse>;
    leaderboard: (mode: "solo" | "coop" | "versus") => Promise<{
        entries: LeaderEntry[];
        me?: LeaderEntry;
    }>;
    health: () => Promise<{
        ok: true;
        uptime: number;
        rooms: number;
        players: number;
    }>;
};
export declare function queueSoloResult(body: SoloResultBody): void;
export declare function syncPendingResults(): Promise<void>;
export declare function errorMessage(e: unknown): string;
//# sourceMappingURL=api.d.ts.map