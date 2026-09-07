import { h, clear } from '../../app/h.js';
import { navigate } from '../../app/router.js';
import { app, type AppState } from '../../app/store.js';
import { settings } from '../../app/settings.js';
import { t } from '../../i18n/index.js';
import { button, tankPreview } from '../components.js';
import { openDailyModal } from './daily.js';

let dailyShownAt = 0;
let installPrompt: (Event & { prompt: () => Promise<void> }) | null = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e as Event & { prompt: () => Promise<void> };
});

export function menuScreen(root: HTMLElement): () => void {
  const profile = h('div', { class: 'profile-chip glass', dataset: { testid: 'profile-chip' } });
  const status = h('div', { class: 'net-status', dataset: { testid: 'net-status' } });
  const giftsBadge = h('span', { class: 'badge', dataset: { testid: 'gifts-badge' } });
  const dailyBtn = button(t('menu.daily'), { kind: 'accent', testid: 'menu-daily', className: 'daily-btn', onClick: () => openDailyModal() });
  const installBtn = button(t('menu.install'), { kind: 'ghost', className: 'small', onClick: async () => { await installPrompt?.prompt(); installPrompt = null; installBtn.hidden = true; } });
  installBtn.hidden = !installPrompt;

  const renderProfile = (s: AppState): void => {
    clear(profile);
    const name = s.user?.nickname || settings.get().nickname || t('common.guest');
    profile.append(
      tankPreview(s.user?.skin ?? 'default', 44),
      h('div', { class: 'profile-text' },
        h('div', { class: 'profile-name', dataset: { testid: 'profile-name' } }, name),
        h('div', { class: 'profile-meta' },
          h('span', { class: 'currency coins' }, h('span', { class: 'coin-icon' }), h('span', { dataset: { testid: 'profile-coins' } }, s.wallet.coins.toLocaleString())),
          h('span', { class: 'currency gems' }, h('span', { class: 'gem-icon' }), h('span', { dataset: { testid: 'profile-gems' } }, s.wallet.gems.toLocaleString())),
          s.battlepass ? h('span', { class: 'chip' }, t('menu.tier', { tier: s.battlepass.tier })) : null,
        ),
      ),
    );
    status.className = `net-status ${s.online ? 'online' : 'offline'}`;
    status.textContent = s.online ? t('common.online') : t('common.offline');
    giftsBadge.textContent = s.pendingGifts > 0 ? String(s.pendingGifts) : '';
    giftsBadge.hidden = s.pendingGifts <= 0;
    dailyBtn.hidden = !(s.online && s.daily?.claimable);
    if (s.online && s.daily?.claimable && Date.now() - dailyShownAt > 6 * 3600_000) {
      dailyShownAt = Date.now();
      window.setTimeout(() => openDailyModal(), 300);
    }
  };

  const nav = (label: string, path: string, testid: string, kind: 'primary' | 'secondary' | 'ghost' | 'info' = 'secondary', extra?: HTMLElement): HTMLButtonElement =>
    button([label, extra ?? null], { kind, big: true, testid, onClick: () => navigate(path) });

  const el = h(
    'section',
    { class: 'screen menu', dataset: { testid: 'menu' } },
    h('div', { class: 'menu-bg', attrs: { 'aria-hidden': 'true' } }, ...Array.from({ length: 14 }, (_, i) => h('i', { class: 'spark', style: { '--i': String(i) } as unknown as Partial<CSSStyleDeclaration> }))),
    h('div', { class: 'menu-top' }, profile, status),
    h('div', { class: 'menu-hero' },
      h('h1', { class: 'logo' }, h('span', { class: 'logo-tank' }, 'TANK'), h('span', { class: 'logo-year' }, '1990'), h('span', { class: 'logo-online' }, 'ONLINE')),
      h('p', { class: 'tagline' }, t('app.tagline')),
    ),
    h('nav', { class: 'menu-nav' },
      nav(t('menu.playSolo'), '/play', 'menu-play-solo', 'info'),
      nav(t('menu.multiplayer'), '/lobby', 'menu-multiplayer', 'primary'),
      h('div', { class: 'menu-grid' },
        nav(t('menu.store'), '/store', 'menu-store'),
        nav(t('menu.garage'), '/garage', 'menu-garage'),
        nav(t('menu.battlepass'), '/battlepass', 'menu-battlepass'),
        nav(t('menu.gifts'), '/gifts', 'menu-gifts', 'secondary', giftsBadge),
        nav(t('menu.leaderboard'), '/leaderboard', 'menu-leaderboard'),
        nav(t('menu.settings'), '/settings', 'menu-settings'),
      ),
      dailyBtn,
      installBtn,
    ),
    h('div', { class: 'menu-footer' }, h('span', { class: 'offline-hint', dataset: { testid: 'offline-hint' } })),
  );
  const hint = el.querySelector('.offline-hint') as HTMLElement;
  const renderHint = (s: AppState): void => {
    hint.textContent = s.booted && !s.online ? t('menu.offlineHint') : '';
  };
  renderProfile(app.get());
  renderHint(app.get());
  const unsub = app.subscribe((s) => {
    renderProfile(s);
    renderHint(s);
  });
  root.appendChild(el);
  return () => unsub();
}
