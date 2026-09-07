import type { BoostEffect } from '@tank/shared';

/** Row types shared by both store implementations. All timestamps are ms since epoch. */
export interface UserRow {
  id: string;
  deviceHash: string;
  nickname: string;
  nicknameLc: string;
  skin: string;
  settings: Record<string, unknown>;
  createdAt: number;
  lastSeen: number;
}
export type LedgerCurrency = 'coins' | 'gems';
export interface WalletRow {
  userId: string;
  coins: number;
  gems: number;
}
export interface LedgerRow {
  id: string;
  userId: string;
  currency: LedgerCurrency;
  /** Signed delta. */
  amount: number;
  balanceAfter: number;
  reason: string;
  ref: string | null;
  createdAt: number;
}
export interface InventoryRow {
  userId: string;
  sku: string;
  qty: number;
  equipped: boolean;
}
export type OrderStatus = 'pending' | 'completed' | 'failed';
export interface OrderRow {
  id: string;
  userId: string;
  sku: string;
  provider: 'mock' | 'stripe';
  status: OrderStatus;
  amountCents: number;
  currency: 'usd';
  providerRef: string | null;
  createdAt: number;
  updatedAt: number;
}
export interface GiftRow {
  id: string;
  fromId: string;
  toId: string;
  sku: string;
  qty: number;
  message: string;
  status: 'pending' | 'claimed';
  createdAt: number;
  claimedAt: number | null;
}
export interface BattlepassRow {
  userId: string;
  season: number;
  xp: number;
  premium: boolean;
  claimedFree: number[];
  claimedPremium: number[];
}
export interface DailyRow {
  userId: string;
  streak: number;
  lastClaimDay: number | null;
  lastClaimAt: number | null;
}
export interface AdSessionRow {
  id: string;
  userId: string;
  placement: 'results' | 'menu';
  day: number;
  startedAt: number;
  completedAt: number | null;
  matchResultId: string | null;
  coins: number;
}
export type MatchMode = 'solo' | 'coop' | 'versus';
export interface MatchResultRow {
  id: string;
  userId: string;
  mode: MatchMode;
  score: number;
  stage: number;
  kills: number;
  coins: number;
  xp: number;
  createdAt: number;
}
export interface SoloSessionRow {
  id: string;
  userId: string;
  seed: number;
  stage: number;
  boosts: BoostEffect[];
  createdAt: number;
  consumedAt: number | null;
}
export interface SoloClaimRow {
  userId: string;
  day: number;
  coins: number;
}
export interface UserStats {
  matches: number;
  bestScore: number;
  bestStage: number;
  kills: number;
}

export interface UsersRepo {
  get(id: string): UserRow | undefined;
  getByDeviceHash(hash: string): UserRow | undefined;
  getByNickname(nicknameLc: string): UserRow | undefined;
  insert(row: UserRow): void;
  update(id: string, patch: Partial<Omit<UserRow, 'id'>>): UserRow;
  count(): number;
}
export interface WalletsRepo {
  get(userId: string): WalletRow | undefined;
  put(row: WalletRow): void;
}
export interface LedgerRepo {
  insert(row: LedgerRow): void;
  list(userId: string, limit?: number): LedgerRow[];
}
export interface InventoryRepo {
  get(userId: string, sku: string): InventoryRow | undefined;
  list(userId: string): InventoryRow[];
  put(row: InventoryRow): void;
  remove(userId: string, sku: string): void;
}
export interface OrdersRepo {
  get(id: string): OrderRow | undefined;
  insert(row: OrderRow): void;
  update(id: string, patch: Partial<Omit<OrderRow, 'id'>>): OrderRow;
  list(userId: string): OrderRow[];
  hasCompleted(userId: string, sku: string): boolean;
}
export interface GiftsRepo {
  get(id: string): GiftRow | undefined;
  insert(row: GiftRow): void;
  update(id: string, patch: Partial<Omit<GiftRow, 'id'>>): GiftRow;
  /** Gifts addressed to a user: pending first, newest first within status. */
  listForRecipient(toId: string): GiftRow[];
  countPending(toId: string): number;
  countSentSince(fromId: string, sinceMs: number): number;
}
export interface BattlepassRepo {
  get(userId: string, season: number): BattlepassRow | undefined;
  put(row: BattlepassRow): void;
}
export interface DailyRepo {
  get(userId: string): DailyRow | undefined;
  put(row: DailyRow): void;
}
export interface AdsRepo {
  get(id: string): AdSessionRow | undefined;
  insert(row: AdSessionRow): void;
  update(id: string, patch: Partial<Omit<AdSessionRow, 'id'>>): AdSessionRow;
  countForDay(userId: string, day: number): number;
  hasCompletedForMatch(userId: string, matchResultId: string): boolean;
}
export interface MatchesRepo {
  insert(row: MatchResultRow): void;
  latest(userId: string): MatchResultRow | undefined;
  stats(userId: string): UserStats;
  /** Best result per user for a mode, sorted by score desc (ties: older first). */
  bestPerUser(mode: MatchMode): MatchResultRow[];
}
export interface SoloRepo {
  get(id: string): SoloSessionRow | undefined;
  insert(row: SoloSessionRow): void;
  update(id: string, patch: Partial<Omit<SoloSessionRow, 'id'>>): SoloSessionRow;
}
export interface SoloClaimsRepo {
  get(userId: string, day: number): SoloClaimRow | undefined;
  put(row: SoloClaimRow): void;
}

/** The repository bundle. `transaction` must be re-entrant and roll back on throw. */
export interface Db {
  readonly kind: 'sqlite' | 'json';
  transaction<T>(fn: () => T): T;
  close(): void;
  users: UsersRepo;
  wallets: WalletsRepo;
  ledger: LedgerRepo;
  inventory: InventoryRepo;
  orders: OrdersRepo;
  gifts: GiftsRepo;
  battlepass: BattlepassRepo;
  daily: DailyRepo;
  ads: AdsRepo;
  matches: MatchesRepo;
  solo: SoloRepo;
  soloClaims: SoloClaimsRepo;
}

/** Sort helper for gift inboxes: pending first, then newest first. */
export function sortGifts(rows: GiftRow[]): GiftRow[] {
  return rows.sort((a, b) => (a.status === b.status ? b.createdAt - a.createdAt : a.status === 'pending' ? -1 : 1));
}

/** Reduces all results to the best per user, sorted for a leaderboard. */
export function bestPerUserOf(rows: MatchResultRow[]): MatchResultRow[] {
  const best = new Map<string, MatchResultRow>();
  for (const r of rows) {
    const cur = best.get(r.userId);
    if (!cur || r.score > cur.score || (r.score === cur.score && r.createdAt < cur.createdAt)) best.set(r.userId, r);
  }
  return [...best.values()].sort((a, b) => b.score - a.score || a.createdAt - b.createdAt);
}

export function statsOf(rows: MatchResultRow[]): UserStats {
  const s: UserStats = { matches: 0, bestScore: 0, bestStage: 0, kills: 0 };
  for (const r of rows) {
    s.matches++;
    s.bestScore = Math.max(s.bestScore, r.score);
    s.bestStage = Math.max(s.bestStage, r.stage);
    s.kills += r.kills;
  }
  return s;
}
