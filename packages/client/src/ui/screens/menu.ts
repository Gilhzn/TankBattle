import { BRAND } from '@tank/shared';
import { Api } from '../../app/api.js';
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
  // Pending friend requests are worth surfacing on the menu: someone is waiting on an answer.
  const friendsBadge = h('span', { class: 'badge', dataset: { testid: 'friends-badge' } });
  friendsBadge.hidden = true;
  const refreshFriendsBadge = async (): Promise<void> => {
    if (!app.get().online) return;
    try {
      const { incoming } = await Api.friends();
      friendsBadge.textContent = incoming.length ? String(incoming.length) : '';
      friendsBadge.hidden = incoming.length === 0;
    } catch {
      // A badge is not worth surfacing an error over; it simply stays hidden.
    }
  };
  const dailyBtn = button(t('menu.daily'), { kind: 'secondary', testid: 'menu-daily', className: 'daily-btn', onClick: () => openDailyModal() });
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
      h('h1', { class: 'logo' }, h('span', { class: 'logo-a' }, BRAND.logo[0]), h('span', { class: 'logo-b' }, BRAND.logo[1]), h('span', { class: 'logo-sub' }, 'ONLINE')),
      h('p', { class: 'tagline' }, t('app.tagline')),
    ),
    // Grouped by what each thing is for, and how often it is reached for: the two ways to start a
    // match, then what you spend on your tank, then the people you play with, then the rest. The
    // grouping is done with space alone — headings here would be chrome standing in for structure,
    // and the labels already say what each button is.
    h('nav', { class: 'menu-nav' },
      h('div', { class: 'menu-group menu-group-lead' },
        nav(t('menu.playSolo'), '/play', 'menu-play-solo'),
        nav(t('menu.multiplayer'), '/lobby', 'menu-multiplayer', 'primary'),
      ),
      h('div', { class: 'menu-group menu-grid' },
        nav(t('menu.store'), '/store', 'menu-store'),
        nav(t('menu.garage'), '/garage', 'menu-garage'),
        nav(t('menu.battlepass'), '/battlepass', 'menu-battlepass'),
        nav(t('menu.gifts'), '/gifts', 'menu-gifts', 'secondary', giftsBadge),
      ),
      h('div', { class: 'menu-group menu-grid' },
        nav(t('menu.friends'), '/friends', 'menu-friends', 'secondary', friendsBadge),
        nav(t('menu.profile'), '/profile', 'menu-profile'),
        nav(t('menu.leaderboard'), '/leaderboard', 'menu-leaderboard'),
        nav(t('menu.settings'), '/settings', 'menu-settings'),
      ),
      h('div', { class: 'menu-group' }, dailyBtn, installBtn),
    ),
    h('div', { class: 'menu-footer' }, h('span', { class: 'offline-hint', dataset: { testid: 'offline-hint' } })),
  );
  const hint = el.querySelector('.offline-hint') as HTMLElement;
  const renderHint = (s: AppState): void => {
    // While a sleeping host wakes, say so — 40 seconds of nothing reads as a broken link.
    hint.textContent = s.waking ? t('app.waking') : s.booted && !s.online ? t('menu.offlineHint') : '';
  };
  renderProfile(app.get());
  renderHint(app.get());
  const unsub = app.subscribe((s) => {
    renderProfile(s);
    renderHint(s);
  });
  root.appendChild(el);
  void refreshFriendsBadge();
  return () => unsub();
}
