import type { BattlePassDTO, DailyDTO, InventoryDTO, StatsDTO, UserDTO, WalletDTO } from './api.js';

/** Minimal reactive store: get / set (patch or updater) / subscribe. */
export class Store<T extends object> {
  private listeners = new Set<(state: T, prev: T) => void>();
  constructor(private state: T) {}

  get(): T {
    return this.state;
  }

  set(patch: Partial<T> | ((prev: T) => Partial<T>)): void {
    const prev = this.state;
    const next = typeof patch === 'function' ? patch(prev) : patch;
    let changed = false;
    for (const k of Object.keys(next) as (keyof T)[]) {
      if (prev[k] !== next[k]) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    this.state = { ...prev, ...next };
    for (const l of [...this.listeners]) l(this.state, prev);
  }

  subscribe(listener: (state: T, prev: T) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Subscribe to a derived value; fires only when it changes. */
  select<V>(selector: (s: T) => V, listener: (v: V) => void): () => void {
    let last = selector(this.state);
    return this.subscribe((s) => {
      const v = selector(s);
      if (v !== last) {
        last = v;
        listener(v);
      }
    });
  }
}

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error' | 'success';
  action?: { label: string; run: () => void };
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

export const app = new Store<AppState>({
  screen: 'boot',
  booted: false,
  online: false,
  token: null,
  user: null,
  wallet: { coins: 0, gems: 0 },
  inventory: {},
  battlepass: null,
  daily: null,
  stats: null,
  pendingGifts: 0,
  provider: 'mock',
  toasts: [],
  updateAvailable: false,
});

let toastId = 0;
export function toast(text: string, kind: Toast['kind'] = 'info', action?: Toast['action'], ttl = 3500): void {
  const id = ++toastId;
  app.set((s) => ({ toasts: [...s.toasts, { id, text, kind, action }] }));
  if (ttl > 0) window.setTimeout(() => dismissToast(id), ttl);
}
export function dismissToast(id: number): void {
  app.set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}

export function ownedQty(sku: string): number {
  return app.get().inventory[sku]?.qty ?? 0;
}
