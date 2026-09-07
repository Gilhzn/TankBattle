import { Api, applyWallet, errorMessage, refreshQuietly } from '../../app/api.js';
import { h } from '../../app/h.js';
import { navigate } from '../../app/router.js';
import { toast } from '../../app/store.js';
import { t } from '../../i18n/index.js';
import { button, labelled, panel, screenShell } from '../components.js';

/** Sandbox (mock provider) checkout page: /#/checkout/:orderId */
export function checkoutScreen(root: HTMLElement, params: Record<string, string>): () => void {
  const orderId = params.orderId ?? '';
  const shell = screenShell(t('checkout.title'), { back: '/store', testid: 'checkout' });
  root.appendChild(shell.el);
  const card = h('input', { class: 'input', type: 'text', inputMode: 'numeric', value: '4242 4242 4242 4242', autocomplete: 'off', dataset: { testid: 'checkout-card' } });
  const expiry = h('input', { class: 'input', type: 'text', value: '12/29', autocomplete: 'off' });
  const cvc = h('input', { class: 'input', type: 'text', inputMode: 'numeric', value: '123', autocomplete: 'off' });
  const name = h('input', { class: 'input', type: 'text', value: 'Sandbox Tester', autocomplete: 'off' });
  const status = h('div', { class: 'checkout-status', dataset: { testid: 'checkout-status' } });
  let timer = 0;

  const pay = button(t('checkout.pay'), {
    kind: 'primary',
    big: true,
    testid: 'checkout-pay',
    onClick: async () => {
      pay.disabled = true;
      pay.textContent = t('checkout.paying');
      try {
        const res = await Api.mockComplete(orderId);
        applyWallet(res.wallet, res.inventory);
        void refreshQuietly();
        form.hidden = true;
        status.replaceChildren(
          h('div', { class: 'success-anim', dataset: { testid: 'checkout-success' } }, h('div', { class: 'check' })),
          h('h2', null, t('checkout.success')),
          h('p', { class: 'muted' }, `${t('checkout.order', { id: res.order.id })} · ${res.order.status}`),
          button(t('checkout.backToStore'), { kind: 'primary', onClick: () => navigate('/store') }),
        );
        timer = window.setTimeout(() => navigate('/store'), 3000);
      } catch (e) {
        toast(errorMessage(e), 'error');
        status.textContent = `${t('checkout.failed')}: ${errorMessage(e)}`;
        pay.disabled = false;
        pay.textContent = t('checkout.pay');
      }
    },
  });

  const form = panel(
    h('p', { class: 'notice warn' }, t('checkout.sandbox')),
    h('p', { class: 'muted' }, t('checkout.order', { id: orderId })),
    labelled(t('checkout.card'), card),
    h('div', { class: 'row' }, labelled(t('checkout.expiry'), expiry), labelled(t('checkout.cvc'), cvc)),
    labelled(t('checkout.name'), name),
    pay,
  );
  shell.body.append(form, status);
  return () => {
    window.clearTimeout(timer);
    shell.el.remove();
  };
}
