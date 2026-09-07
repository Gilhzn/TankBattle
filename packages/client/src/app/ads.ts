import { Api, ApiError, applyWallet } from './api.js';
import { h } from './h.js';
import { t } from '../i18n/index.js';

export interface AdResult {
  ok: boolean;
  coins: number;
  error?: string;
}

export interface AdProvider {
  /** Shows a rewarded ad for `placement`; resolves with the server-credited coins. */
  show(placement: 'results' | 'menu'): Promise<AdResult>;
}

/**
 * Mock rewarded-ad provider: asks the server for an ad session, shows a full-screen countdown
 * (min seconds enforced server-side) and completes the session for the reward.
 */
export class MockAdProvider implements AdProvider {
  async show(placement: 'results' | 'menu'): Promise<AdResult> {
    let session: { adSessionId: string; minSeconds: number; remainingToday: number };
    try {
      session = await Api.adStart(placement);
    } catch (e) {
      return { ok: false, coins: 0, error: e instanceof ApiError ? e.message : 'network' };
    }
    const seconds = Math.max(1, Math.min(60, session.minSeconds || 15));
    await this.playCountdown(seconds);
    try {
      const res = await Api.adComplete(session.adSessionId, placement);
      applyWallet(res.wallet);
      return { ok: true, coins: res.coins };
    } catch (e) {
      return { ok: false, coins: 0, error: e instanceof ApiError ? e.message : 'network' };
    }
  }

  private playCountdown(seconds: number): Promise<void> {
    return new Promise((resolve) => {
      let left = seconds;
      const counter = h('div', { class: 'ad-counter', dataset: { testid: 'ad-counter' } }, t('results.adWatching', { s: left }));
      const bar = h('div', { class: 'ad-bar' }, h('div', { class: 'ad-bar-fill' }));
      const el = h('div', { class: 'ad-overlay', dataset: { testid: 'ad-overlay' } }, h('div', { class: 'ad-card glass' }, h('div', { class: 'ad-logo' }, 'AD'), h('div', { class: 'ad-text' }, 'Sandbox rewarded ad'), bar, counter));
      document.body.appendChild(el);
      const fill = bar.firstElementChild as HTMLElement;
      const start = performance.now();
      const tick = (): void => {
        const elapsed = (performance.now() - start) / 1000;
        left = Math.max(0, Math.ceil(seconds - elapsed));
        counter.textContent = t('results.adWatching', { s: left });
        fill.style.width = `${Math.min(100, (elapsed / seconds) * 100)}%`;
        if (elapsed >= seconds + 0.2) {
          el.remove();
          resolve();
        } else window.setTimeout(tick, 250);
      };
      tick();
    });
  }
}

export const ads: AdProvider = new MockAdProvider();
