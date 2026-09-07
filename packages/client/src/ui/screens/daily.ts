import { DAILY_REWARDS } from '@tank/shared';
import { Api, applyWallet, errorMessage } from '../../app/api.js';
import { h, clear } from '../../app/h.js';
import { app, toast } from '../../app/store.js';
import { t } from '../../i18n/index.js';
import { button, formatDuration, modal, rewardIcon, rewardLabel } from '../components.js';

let open = false;

/** Daily reward modal (auto-opened from the menu when claimable). */
export function openDailyModal(): void {
  if (open) return;
  open = true;
  const body = h('div', { class: 'daily' });
  const m = modal(body, { testid: 'daily-modal', onClose: () => (open = false) });

  const render = (): void => {
    const d = app.get().daily;
    clear(body);
    const rewards = d?.rewards?.length ? d.rewards : DAILY_REWARDS;
    const day = d?.day ?? 1;
    body.append(
      h('h2', null, t('daily.title')),
      h('p', { class: 'muted' }, t('daily.streak', { n: d?.streak ?? 0 })),
      h(
        'div',
        { class: 'daily-strip' },
        ...rewards.map((r, i) => {
          const n = i + 1;
          const state = n < day ? 'done' : n === day ? (d?.claimable ? 'today' : 'next') : 'future';
          return h('div', { class: `daily-day ${state}`, dataset: { day: String(n) } }, h('div', { class: 'daily-num' }, t('daily.day', { n })), rewardIcon(r), h('div', { class: 'daily-reward' }, rewardLabel(r)));
        }),
      ),
      d?.claimable
        ? button(t('daily.claim'), {
            kind: 'primary',
            big: true,
            testid: 'daily-claim',
            onClick: async (e) => {
              const btn = e.currentTarget as HTMLButtonElement;
              btn.disabled = true;
              try {
                const res = await Api.dailyClaim();
                applyWallet(res.wallet, res.inventory);
                app.set({ daily: res.daily });
                toast(`${t('daily.claimed')} ${rewardLabel(res.reward)}`, 'success');
                render();
              } catch (err) {
                toast(errorMessage(err), 'error');
                btn.disabled = false;
              }
            },
          })
        : h('p', { class: 'muted', dataset: { testid: 'daily-wait' } }, d ? t('daily.comeBack', { time: formatDuration(d.nextClaimAt - Date.now()) }) : t('common.offline')),
      button(t('common.close'), { kind: 'ghost', onClick: () => m.close() }),
    );
  };
  render();
}
