import type { BattlePassTier, BoostEffect, CatalogItem } from '@tank/shared';
import { app, toast } from './store.js';
import { settings } from './settings.js';
import { t } from '../i18n/index.js';

// ---------- DTOs (docs/API.md) ----------
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
export type InventoryDTO = Record<string, { qty: number; equipped: boolean }>;
export interface DailyDTO {
  streak: number;
  day: number;
  claimable: boolean;
  nextClaimAt: number;
  rewards: Array<{ coins?: number; gems?: number; items?: Record<string, number> }>;
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

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const TOKEN_KEY = 'tank1990.token';
const DEVICE_KEY = 'tank1990.deviceToken';

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function deviceToken(): string {
  try {
    let tok = localStorage.getItem(DEVICE_KEY);
    if (!tok) {
      tok = randomHex(16);
      localStorage.setItem(DEVICE_KEY, tok);
    }
    return tok;
  } catch {
    return randomHex(16);
  }
}

export function getToken(): string | null {
  const s = app.get().token;
  if (s) return s;
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function setToken(token: string | null): void {
  app.set({ token });
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export async function api<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown, opts: { auth?: boolean; timeoutMs?: number } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = getToken();
  if (opts.auth !== false && token) headers.Authorization = `Bearer ${token}`;
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 12000);
  let res: Response;
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctrl.signal });
  } catch (e) {
    throw new ApiError(0, 'network', (e as Error).message || 'network');
  } finally {
    window.clearTimeout(timer);
  }
  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  if (!res.ok) {
    const err = (json as { error?: { code?: string; message?: string } } | null)?.error;
    if (res.status === 401 && opts.auth !== false) {
      // token expired/invalid: drop it so the next boot re-authenticates
      setToken(null);
    }
    throw new ApiError(res.status, err?.code ?? `http_${res.status}`, err?.message ?? res.statusText);
  }
  return json as T;
}

/** Guest auth + /api/me. Never throws; leaves the app in offline mode when the server is unreachable. */
export async function boot(): Promise<void> {
  try {
    if (!getToken()) {
      const nick = settings.get().nickname.trim();
      const res = await api<{ token: string; user: UserDTO; isNew: boolean }>('POST', '/api/auth/guest', {
        deviceToken: deviceToken(),
        ...(nick.length >= 2 ? { nickname: nick } : {}),
      }, { auth: false });
      setToken(res.token);
      app.set({ user: res.user });
    }
    await refreshMe();
    app.set({ online: true });
    void syncPendingResults();
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      // retry once with a fresh guest session
      setToken(null);
      try {
        const res = await api<{ token: string; user: UserDTO; isNew: boolean }>('POST', '/api/auth/guest', { deviceToken: deviceToken() }, { auth: false });
        setToken(res.token);
        await refreshMe();
        app.set({ online: true });
        return;
      } catch {
        /* fall through to offline */
      }
    }
    app.set({ online: false });
  } finally {
    app.set({ booted: true });
  }
}

export async function refreshMe(): Promise<MeResponse> {
  const me = await api<MeResponse>('GET', '/api/me');
  app.set({
    user: me.user,
    wallet: me.wallet,
    inventory: me.inventory,
    battlepass: me.battlepass,
    daily: me.daily,
    stats: me.stats,
    pendingGifts: me.pendingGifts,
    provider: me.provider,
    online: true,
  });
  if (me.user.nickname && me.user.nickname !== settings.get().nickname) settings.set({ nickname: me.user.nickname });
  return me;
}

/** Refresh silently after an economy action (errors are swallowed). */
export async function refreshQuietly(): Promise<void> {
  try {
    await refreshMe();
  } catch {
    /* ignore */
  }
}

export function applyWallet(wallet?: WalletDTO, inventory?: InventoryDTO): void {
  const patch: Partial<{ wallet: WalletDTO; inventory: InventoryDTO }> = {};
  if (wallet) patch.wallet = wallet;
  if (inventory) patch.inventory = inventory;
  app.set(patch);
}

// ---------- typed endpoints ----------
export const Api = {
  patchMe: (body: { nickname?: string; skin?: string; settings?: Record<string, unknown> }) => api<{ user: UserDTO }>('PATCH', '/api/me', body),
  catalog: () => api<{ items: CatalogItem[]; ownedOneTime: string[]; provider: 'mock' | 'stripe' }>('GET', '/api/store/catalog'),
  purchase: (sku: string, qty: number, currency: 'coins' | 'gems') => api<{ wallet: WalletDTO; inventory: InventoryDTO }>('POST', '/api/store/purchase', { sku, qty, currency }),
  checkout: (sku: string) => api<{ orderId: string; provider: 'mock' | 'stripe'; redirectUrl?: string; clientSecret?: string }>('POST', '/api/store/checkout', { sku }),
  mockComplete: (orderId: string) => api<{ order: OrderDTO; wallet: WalletDTO; inventory: InventoryDTO }>('POST', '/api/store/mock/complete', { orderId }),
  orders: () => api<{ orders: OrderDTO[] }>('GET', '/api/store/orders'),
  inventory: () => api<{ inventory: InventoryDTO }>('GET', '/api/inventory'),
  equip: (sku: string) => api<{ user: UserDTO; inventory: InventoryDTO }>('POST', '/api/inventory/equip', { sku }),
  daily: () => api<DailyDTO>('GET', '/api/rewards/daily'),
  dailyClaim: () => api<{ reward: DailyDTO['rewards'][number]; wallet: WalletDTO; inventory: InventoryDTO; daily: DailyDTO }>('POST', '/api/rewards/daily/claim'),
  adStart: (placement: 'results' | 'menu') => api<{ adSessionId: string; minSeconds: number; remainingToday: number }>('POST', '/api/rewards/ad/start', { placement }),
  adComplete: (adSessionId: string, placement: 'results' | 'menu') => api<{ coins: number; wallet: WalletDTO }>('POST', '/api/rewards/ad/complete', { adSessionId, placement }),
  battlepass: () => api<BattlePassDTO>('GET', '/api/battlepass'),
  bpClaim: (tier: number, track: 'free' | 'premium') => api<{ wallet: WalletDTO; inventory: InventoryDTO; battlepass: BattlePassDTO }>('POST', '/api/battlepass/claim', { tier, track }),
  bpPremium: () => api<{ wallet: WalletDTO; battlepass: BattlePassDTO }>('POST', '/api/battlepass/premium'),
  giftSend: (to: string, sku: string, qty: number, message?: string) => api<{ gift: GiftDTO; inventory: InventoryDTO; wallet: WalletDTO }>('POST', '/api/gifts/send', { to, sku, qty, ...(message ? { message } : {}) }),
  giftInbox: () => api<{ gifts: GiftDTO[] }>('GET', '/api/gifts/inbox'),
  giftClaim: (id: string) => api<{ wallet: WalletDTO; inventory: InventoryDTO }>('POST', `/api/gifts/${encodeURIComponent(id)}/claim`),
  soloStart: (loadout: string[], stage = 1, difficulty = 'normal') => api<SoloStartResponse>('POST', '/api/solo/start', { loadout, stage, difficulty }),
  soloResult: (body: SoloResultBody) => api<SoloResultResponse>('POST', '/api/solo/result', body, { timeoutMs: 30000 }),
  leaderboard: (mode: 'solo' | 'coop' | 'versus') => api<{ entries: LeaderEntry[]; me?: LeaderEntry }>('GET', `/api/leaderboard?mode=${mode}`),
  health: () => api<{ ok: true; uptime: number; rooms: number; players: number }>('GET', '/api/health', undefined, { auth: false, timeoutMs: 4000 }),
};

// ---------- offline result queue ----------
const PENDING_KEY = 'tank1990.pendingResults';

export function queueSoloResult(body: SoloResultBody): void {
  try {
    const list = JSON.parse(localStorage.getItem(PENDING_KEY) ?? '[]') as SoloResultBody[];
    list.push(body);
    localStorage.setItem(PENDING_KEY, JSON.stringify(list.slice(-5)));
  } catch {
    /* ignore */
  }
}

export async function syncPendingResults(): Promise<void> {
  let list: SoloResultBody[] = [];
  try {
    list = JSON.parse(localStorage.getItem(PENDING_KEY) ?? '[]') as SoloResultBody[];
  } catch {
    return;
  }
  if (!list.length) return;
  const remaining: SoloResultBody[] = [];
  let synced = 0;
  for (const body of list) {
    try {
      await Api.soloResult(body);
      synced++;
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) remaining.push(body);
      // 4xx: drop (already submitted / invalid)
    }
  }
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(remaining));
  } catch {
    /* ignore */
  }
  if (synced) {
    toast(t('results.verified'), 'success');
    await refreshQuietly();
  }
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 0) return t('err.network');
    if (e.status === 401) return t('err.unauthorized');
    return e.message || e.code;
  }
  return (e as Error)?.message ?? t('common.error');
}
