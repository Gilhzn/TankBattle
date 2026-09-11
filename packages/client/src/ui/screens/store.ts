import { CATALOG, type CatalogItem, type ItemKind } from '@tank/shared';
import { Api, applyWallet, errorMessage, refreshQuietly } from '../../app/api.js';
import { h, clear } from '../../app/h.js';
import { navigate } from '../../app/router.js';
import { app, toast } from '../../app/store.js';
import { t, itemDesc } from '../../i18n/index.js';
import { button, displayName, itemIcon, offlineNotice, priceText, screenShell, tabs, walletChip } from '../components.js';

type Tab = 'gems' | 'boosts' | 'skins' | 'bundles';
const TAB_KINDS: Record<Tab, ItemKind[]> = { gems: ['currency'], boosts: ['boost'], skins: ['cosmetic'], bundles: ['bundle', 'pass'] };

export function storeScreen(root: HTMLElement): () => void {
  const wallet = walletChip();
  const shell = screenShell(t('store.title'), { back: '/', testid: 'store', right: wallet.el });
  root.appendChild(shell.el);
  let tab: Tab = 'gems';
  let items: CatalogItem[] = CATALOG;
  let ownedOneTime: string[] = [];
  const grid = h('div', { class: 'store-grid' });
  const notice = h('div', { class: 'store-notice' });

  const renderItems = (): void => {
    clear(grid);
    const s = app.get();
    for (const item of items.filter((i) => TAB_KINDS[tab].includes(i.kind))) {
      const owned = s.inventory[item.sku]?.qty ?? 0;
      const oneTimeOwned = item.oneTime && (ownedOneTime.includes(item.sku) || owned > 0 || (item.sku === 'battlepass_premium' && s.battlepass?.premium));
      const actions: HTMLElement[] = [];
      const buy = async (currency: 'coins' | 'gems' | 'usd', btn: HTMLButtonElement): Promise<void> => {
        btn.disabled = true;
        try {
          if (currency === 'usd') {
            const res = await Api.checkout(item.sku);
            toast(t('store.checkoutRedirect'));
            if (res.redirectUrl) {
              if (res.redirectUrl.startsWith('/#')) navigate(res.redirectUrl.slice(2));
              else location.href = res.redirectUrl;
            } else if (res.provider === 'stripe' && res.clientSecret) {
              toast('Stripe checkout is not wired in this build', 'error');
            }
            return;
          }
          const price = item.prices[currency] ?? 0;
          if (s.wallet[currency] < price) {
            toast(t('store.notEnough', { currency: currency === 'coins' ? t('common.coins') : t('common.gems') }), 'error');
            return;
          }
          const res = await Api.purchase(item.sku, 1, currency);
          applyWallet(res.wallet, res.inventory);
          toast(t('store.purchased', { item: displayName(item.sku) }), 'success');
          void refreshQuietly();
        } catch (e) {
          toast(errorMessage(e), 'error');
        } finally {
          btn.disabled = false;
          renderItems();
        }
      };
      if (!oneTimeOwned) {
        for (const cur of ['coins', 'gems', 'usd'] as const) {
          if (item.prices[cur] === undefined) continue;
          const b = button([h('span', { class: `${cur === 'coins' ? 'coin-icon' : cur === 'gems' ? 'gem-icon' : ''}` }), priceText(item, cur)], {
            // Neutral face, tinted label: in a list every row's action is equal, and filling five
            // of them would put the emphasis everywhere, which is the same as nowhere. The one
            // recommended item fills its button instead (see `.store-item.best` in screens.css).
            kind: 'secondary',
            className: 'buy',
            testid: `buy-${item.sku}-${cur}`,
            disabled: !s.online,
            onClick: (e) => void buy(cur, e.currentTarget as HTMLButtonElement),
          });
          actions.push(b);
        }
      }
      grid.appendChild(
        h(
          'article',
          { class: `store-item glass ${item.tag ?? ''}`, dataset: { testid: `store-item-${item.sku}`, sku: item.sku } },
          item.tag ? h('span', { class: `tag ${item.tag}` }, t(`store.tag.${item.tag}`)) : null,
          h('div', { class: 'store-item-icon' }, itemIcon(item.sku, 'lg')),
          h('div', { class: 'store-item-body' },
            h('h3', null, displayName(item.sku)),
            h('p', { class: 'muted' }, itemDesc(item.sku, item.description)),
            owned > 0 && item.kind === 'boost' ? h('span', { class: 'chip' }, `${t('common.owned')} ×${owned}`) : null,
            oneTimeOwned ? h('span', { class: 'chip ready' }, t('common.owned')) : item.oneTime ? h('span', { class: 'chip' }, t('store.oneTime')) : null,
          ),
          h('div', { class: 'store-item-actions' }, ...actions),
        ),
      );
    }
  };

  const renderNotice = (): void => {
    clear(notice);
    const s = app.get();
    if (!s.online) notice.appendChild(offlineNotice());
    else notice.appendChild(h('div', { class: 'muted small' }, t('store.provider', { provider: s.provider })));
  };

  shell.body.append(
    tabs<Tab>(
      [
        { id: 'gems', label: t('store.tab.gems'), testid: 'store-tab-gems' },
        { id: 'boosts', label: t('store.tab.boosts'), testid: 'store-tab-boosts' },
        { id: 'skins', label: t('store.tab.skins'), testid: 'store-tab-skins' },
        { id: 'bundles', label: t('store.tab.bundles'), testid: 'store-tab-bundles' },
      ],
      tab,
      (id) => {
        tab = id;
        renderItems();
      },
    ),
    notice,
    grid,
  );
  renderNotice();
  renderItems();
  if (app.get().online) {
    Api.catalog()
      .then((res) => {
        items = res.items?.length ? res.items : CATALOG;
        ownedOneTime = res.ownedOneTime ?? [];
        app.set({ provider: res.provider });
        renderNotice();
        renderItems();
      })
      .catch(() => undefined);
  }
  const unsub = app.subscribe(() => {
    renderNotice();
    renderItems();
  });
  return () => {
    unsub();
    wallet.dispose();
    shell.el.remove();
  };
}
