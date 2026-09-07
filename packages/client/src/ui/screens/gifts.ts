import { CATALOG_BY_SKU } from '@tank/shared';
import { Api, applyWallet, errorMessage, refreshQuietly, type GiftDTO } from '../../app/api.js';
import { h, clear } from '../../app/h.js';
import { app, toast } from '../../app/store.js';
import { t } from '../../i18n/index.js';
import { button, displayName, emptyState, itemIcon, labelled, offlineNotice, panel, screenShell, spinner } from '../components.js';

/** Gifts: inbox with claim buttons + send form by nickname. */
export function giftsScreen(root: HTMLElement): () => void {
  const shell = screenShell(t('gifts.title'), { back: '/', testid: 'gifts' });
  root.appendChild(shell.el);
  const inbox = h('div', { class: 'gift-list', dataset: { testid: 'gifts-inbox' } });
  let gifts: GiftDTO[] = [];

  const renderInbox = (): void => {
    clear(inbox);
    if (!app.get().online) {
      inbox.appendChild(offlineNotice());
      return;
    }
    if (!gifts.length) {
      inbox.appendChild(emptyState(t('gifts.empty')));
      return;
    }
    for (const g of gifts) {
      inbox.appendChild(
        h(
          'div',
          { class: `gift-row ${g.status}`, dataset: { testid: `gift-${g.id}` } },
          itemIcon(g.sku),
          h('div', { class: 'gift-body' }, h('b', null, `${g.qty}× ${displayName(g.sku)}`), h('div', { class: 'muted' }, t('gifts.from', { name: g.fromName })), g.message ? h('div', { class: 'gift-msg' }, `“${g.message}”`) : null),
          g.status === 'pending'
            ? button(t('common.claim'), {
                kind: 'primary',
                className: 'small',
                testid: `gift-claim-${g.id}`,
                onClick: async (e) => {
                  (e.currentTarget as HTMLButtonElement).disabled = true;
                  try {
                    const res = await Api.giftClaim(g.id);
                    applyWallet(res.wallet, res.inventory);
                    toast(t('common.claimed'), 'success');
                    await load();
                    void refreshQuietly();
                  } catch (err) {
                    toast(errorMessage(err), 'error');
                  }
                },
              })
            : h('span', { class: 'chip ready' }, t('common.claimed')),
        ),
      );
    }
  };

  const load = async (): Promise<void> => {
    if (!app.get().online) return renderInbox();
    inbox.replaceChildren(spinner());
    try {
      gifts = (await Api.giftInbox()).gifts;
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
    renderInbox();
  };

  const to = h('input', { class: 'input', type: 'text', maxLength: 40, placeholder: t('gifts.to'), dataset: { testid: 'gift-to' }, autocomplete: 'off' });
  const skuSelect = h('select', { class: 'input', dataset: { testid: 'gift-sku' } });
  const qty = h('input', { class: 'input', type: 'number', min: 1, max: 10, value: '1', dataset: { testid: 'gift-qty' } });
  const message = h('input', { class: 'input', type: 'text', maxLength: 120, placeholder: t('gifts.message') });
  const fillSkus = (): void => {
    clear(skuSelect);
    const inv = app.get().inventory;
    for (const sku of Object.keys(inv)) {
      if ((inv[sku]?.qty ?? 0) <= 0 || !CATALOG_BY_SKU[sku]) continue;
      skuSelect.appendChild(h('option', { value: sku }, `${displayName(sku)} (×${inv[sku].qty})`));
    }
    if (!skuSelect.children.length) skuSelect.appendChild(h('option', { value: '', disabled: true, selected: true }, t('garage.empty')));
  };
  fillSkus();
  const sendBtn = button(t('common.send'), {
    kind: 'primary',
    big: true,
    testid: 'gift-send',
    onClick: async () => {
      if (!to.value.trim() || !skuSelect.value) return;
      sendBtn.disabled = true;
      try {
        const res = await Api.giftSend(to.value.trim(), skuSelect.value, Math.max(1, Math.min(10, Number(qty.value) || 1)), message.value.trim() || undefined);
        applyWallet(res.wallet, res.inventory);
        toast(t('gifts.sent', { name: res.gift.toName }), 'success');
        to.value = '';
        message.value = '';
        fillSkus();
      } catch (e) {
        toast(errorMessage(e), 'error');
      } finally {
        sendBtn.disabled = false;
      }
    },
  });

  shell.body.append(
    panel(h('h2', null, t('gifts.inbox')), inbox),
    panel(h('h2', null, t('gifts.send')), labelled(t('gifts.to'), to), labelled(t('gifts.item'), skuSelect), h('div', { class: 'row' }, labelled(t('common.qty'), qty)), labelled(t('gifts.message'), message), sendBtn),
  );
  void load();
  const unsub = app.select((s) => s.inventory, fillSkus);
  return () => {
    unsub();
    shell.el.remove();
  };
}
