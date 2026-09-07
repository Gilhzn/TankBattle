import './styles/tokens.css';
import './styles/base.css';
import './styles/glass.css';
import './styles/screens.css';
import './styles/touch.css';

import { boot, syncPendingResults } from './app/api.js';
import { h } from './app/h.js';
import { route, setNotFound, startRouter, navigate } from './app/router.js';
import { applyDocumentSettings, settings } from './app/settings.js';
import { app, toast } from './app/store.js';
import { onLangChange, setLang, t } from './i18n/index.js';
import { toastHost } from './ui/components.js';
import { menuScreen } from './ui/screens/menu.js';
import { playScreen } from './ui/screens/play.js';
import { lobbyScreen } from './ui/screens/lobby.js';
import { gameScreen } from './ui/screens/game.js';
import { storeScreen } from './ui/screens/store.js';
import { checkoutScreen } from './ui/screens/checkout.js';
import { garageScreen } from './ui/screens/garage.js';
import { battlepassScreen } from './ui/screens/battlepass.js';
import { giftsScreen } from './ui/screens/gifts.js';
import { leaderboardScreen } from './ui/screens/leaderboard.js';
import { friendsScreen } from './ui/screens/friends.js';
import { signInScreen } from './ui/screens/signin.js';
import { profileScreen } from './ui/screens/profile.js';
import { inviteScreen } from './ui/screens/invite.js';
import { settingsScreen } from './ui/screens/settings.js';

const rootEl = document.getElementById('app')!;

// language + document attributes before the first paint
setLang(settings.get().lang);
applyDocumentSettings();
onLangChange(() => document.documentElement.setAttribute('lang', settings.get().lang));

route('/', 'menu', menuScreen);
route('/play', 'play', playScreen);
route('/lobby', 'lobby', lobbyScreen);
route('/game', 'game', gameScreen);
route('/store', 'store', storeScreen);
route('/checkout/:orderId', 'checkout', checkoutScreen);
route('/garage', 'garage', garageScreen);
route('/battlepass', 'battlepass', battlepassScreen);
route('/gifts', 'gifts', giftsScreen);
route('/leaderboard', 'leaderboard', leaderboardScreen);
route('/friends', 'friends', friendsScreen);
route('/signin', 'signin', signInScreen);
route('/profile', 'profile', profileScreen);
route('/player/:nickname', 'profile', profileScreen);
route('/invite/:code', 'invite', inviteScreen);
route('/settings', 'settings', settingsScreen);
setNotFound((root) => {
  root.appendChild(h('div', { class: 'center' }, h('p', null, '404'), h('button', { class: 'btn primary', type: 'button', onclick: () => navigate('/') }, t('common.menu'))));
});

document.body.appendChild(toastHost());

// test hook: keep window.__tank.screen in sync even outside a match
app.select(
  (s) => s.screen,
  (screen) => {
    if (window.__tank) window.__tank.screen = screen;
    else window.__tank = { view: undefined as never, tick: 0, mode: 'local', screen, input: () => undefined };
  },
);
window.__tank = { view: undefined as never, tick: 0, mode: 'local', screen: 'boot', input: () => undefined };

startRouter(rootEl);
void boot();

window.addEventListener('online', () => {
  if (!app.get().online) void boot();
  else void syncPendingResults();
});
window.addEventListener('offline', () => app.set({ online: false }));

// ---------- PWA service worker (production only) ----------
// The hand-written worker assumes root-absolute paths, so it's skipped on a non-root base
// (e.g. a GitHub Pages project site served under /<repo>/) rather than caching the wrong URLs.
if (import.meta.env.PROD && import.meta.env.BASE_URL === '/' && 'serviceWorker' in navigator) {
  // Only an update to an ALREADY controlling worker counts as "new version"; the very first install is silent.
  const hadController = !!navigator.serviceWorker.controller;
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        reg.addEventListener('updatefound', () => {
          const sw = reg.installing;
          sw?.addEventListener('statechange', () => {
            if (sw.state === 'installed' && hadController) notifyUpdate();
          });
        });
      })
      .catch(() => undefined);
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data?.type === 'sw-updated' && hadController) notifyUpdate();
    });
  });
}

let updateNotified = false;
function notifyUpdate(): void {
  if (updateNotified) return;
  updateNotified = true;
  app.set({ updateAvailable: true });
  toast(t('common.updateAvailable'), 'info', { label: t('common.reload'), run: () => location.reload() }, 0);
}
