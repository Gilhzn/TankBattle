import { BATTLEPASS_TIERS, CATALOG_BY_SKU } from '@tank/shared';
import { Api, applyWallet, errorMessage, type BattlePassDTO } from '../../app/api.js';
import { h, clear } from '../../app/h.js';
import { app, toast } from '../../app/store.js';
import { t } from '../../i18n/index.js';
import { button, offlineNotice, panel, rewardIcon, rewardLabel, screenShell, walletChip } from '../components.js';

/** Battle pass: 30 tiers, free/premium tracks, claim buttons, buy premium. */
export function battlepassScreen(root: HTMLElement): () => void {
  const wallet = walletChip();
  const shell = screenShell(t('bp.title'), { back: '/', testid: 'battlepass', right: wallet.el });
  root.appendChild(shell.el);
  const head = h('div', { class: 'bp-head' });
  const track = h('div', { class: 'bp-track', dataset: { testid: 'bp-track' } });

  const claim = async (tier: number, trackKind: 'free' | 'premium'): Promise<void> => {
    try {
      const res = await Api.bpClaim(tier, trackKind);
      applyWallet(res.wallet, res.inventory);
      app.set({ battlepass: res.battlepass });
      toast(t('common.claimed'), 'success');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };
  const buyPremium = async (): Promise<void> => {
    try {
      const res = await Api.bpPremium();
      applyWallet(res.wallet);
      app.set({ battlepass: res.battlepass });
      toast(t('bp.premiumOwned'), 'success');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  const render = (): void => {
    const s = app.get();
    const bp: BattlePassDTO | null = s.battlepass;
    clear(head);
    clear(track);
    if (!s.online || !bp) {
      head.appendChild(offlineNotice());
    }
    const tiers = bp?.tiers?.length ? bp.tiers : BATTLEPASS_TIERS;
    const curTier = bp?.tier ?? 0;
    const xp = bp?.xp ?? 0;
    const prev = curTier > 0 ? tiers[curTier - 1]?.xp ?? 0 : 0;
    const next = tiers[curTier]?.xp ?? prev;
    const pct = next > prev ? Math.min(100, ((xp - prev) / (next - prev)) * 100) : 100;
    const premiumPrice = CATALOG_BY_SKU.battlepass_premium?.prices.gems ?? 950;
    head.append(
      h('div', { class: 'bp-summary' },
        h('div', null, h('div', { class: 'muted' }, bp ? `${t('bp.season', { n: bp.season })} · ${t('bp.endsIn', { days: Math.max(0, Math.ceil((bp.endsAt - Date.now()) / 86400000)) })}` : ''), h('div', { class: 'bp-tier', dataset: { testid: 'bp-tier' } }, t('bp.tier', { n: curTier }))),
        h('div', { class: 'bp-xp' }, t('bp.xp', { xp }), h('div', { class: 'bar' }, h('div', { class: 'bar-fill', style: { width: `${pct}%` } })), h('small', { class: 'muted' }, t('bp.nextTier', { xp: Math.max(0, next - xp) }))),
      ),
      bp?.premium ? h('div', { class: 'chip ready' }, t('bp.premiumOwned')) : button(t('bp.buyPremium', { price: premiumPrice }), { kind: 'accent', big: true, testid: 'bp-buy-premium', disabled: !s.online, onClick: () => void buyPremium() }),
    );
    for (const tier of tiers) {
      const unlocked = tier.tier <= curTier;
      const freeClaimed = bp?.claimedFree.includes(tier.tier) ?? false;
      const premClaimed = bp?.claimedPremium.includes(tier.tier) ?? false;
      const cell = (kind: 'free' | 'premium', reward: typeof tier.free, claimed: boolean, allowed: boolean): HTMLElement =>
        h(
          'div',
          { class: `bp-cell ${kind} ${claimed ? 'claimed' : ''} ${unlocked ? 'unlocked' : 'locked'}` },
          rewardIcon(reward),
          h('div', { class: 'bp-reward' }, rewardLabel(reward)),
          reward && !claimed && unlocked && allowed && s.online
            ? button(t('common.claim'), { kind: 'primary', className: 'small', testid: `bp-claim-${kind}-${tier.tier}`, onClick: () => void claim(tier.tier, kind) })
            : claimed
              ? h('span', { class: 'chip ready' }, t('common.claimed'))
              : !unlocked
                ? h('span', { class: 'chip' }, t('bp.locked'))
                : null,
        );
      track.appendChild(
        h(
          'div',
          { class: `bp-col ${tier.tier === curTier ? 'current' : ''}`, dataset: { tier: String(tier.tier) } },
          h('div', { class: 'bp-col-head' }, String(tier.tier), h('small', null, t('bp.xp', { xp: tier.xp }))),
          cell('free', tier.free, freeClaimed, true),
          cell('premium', tier.premium, premClaimed, !!bp?.premium),
        ),
      );
    }
    const cur = track.querySelector('.bp-col.current');
    if (cur) window.requestAnimationFrame(() => cur.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'auto' }));
  };

  shell.body.append(panel(head), h('div', { class: 'bp-legend' }, h('span', { class: 'chip' }, t('bp.free')), h('span', { class: 'chip premium' }, t('bp.premium'))), track);
  render();
  if (app.get().online) Api.battlepass().then((bp) => app.set({ battlepass: bp })).catch(() => undefined);
  const unsub = app.subscribe(render);
  return () => {
    unsub();
    wallet.dispose();
    shell.el.remove();
  };
}
