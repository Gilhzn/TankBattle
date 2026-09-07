import { BATTLEPASS_TIERS, type MatchResult } from '@tank/shared';
import { ads } from '../../app/ads.js';
import { h } from '../../app/h.js';
import { app } from '../../app/store.js';
import { t } from '../../i18n/index.js';
import { button } from '../components.js';

export interface ResultsInfo {
  mode: 'solo' | 'coop' | 'versus';
  won: boolean;
  score: number;
  kills: number;
  stage: number;
  coins: number;
  xp: number;
  /** false when the server could not verify / we are offline */
  verified: boolean | null;
  unsynced: boolean;
  results?: MatchResult[];
  myId?: string;
  onPlayAgain: () => void;
  onMenu: () => void;
  playAgainLabel?: string;
}

function passProgress(): { tier: number; pct: number; label: string } | null {
  const bp = app.get().battlepass;
  if (!bp) return null;
  const tiers = bp.tiers?.length ? bp.tiers : BATTLEPASS_TIERS;
  const prev = bp.tier > 0 ? tiers[bp.tier - 1]?.xp ?? 0 : 0;
  const next = tiers[bp.tier]?.xp ?? prev;
  const pct = next > prev ? Math.max(0, Math.min(100, ((bp.xp - prev) / (next - prev)) * 100)) : 100;
  return { tier: bp.tier, pct, label: t('bp.nextTier', { xp: Math.max(0, next - bp.xp) }) };
}

/** Full-screen results overlay appended to `container`. Returns a dispose function. */
export function showResults(container: HTMLElement, info: ResultsInfo): () => void {
  const stat = (label: string, value: string | number, testid?: string): HTMLElement =>
    h('div', { class: 'stat', dataset: testid ? { testid } : undefined }, h('div', { class: 'stat-value' }, String(value)), h('div', { class: 'stat-label' }, label));

  const coinsEl = h('div', { class: 'stat-value', dataset: { testid: 'results-coins' } }, String(info.coins));
  const pass = passProgress();
  const passEl = pass
    ? h(
        'div',
        { class: 'pass-progress' },
        h('div', { class: 'pass-label' }, t('results.passProgress', { tier: pass.tier }), h('span', { class: 'muted' }, ` · ${pass.label}`)),
        h('div', { class: 'bar' }, h('div', { class: 'bar-fill', style: { width: `${pass.pct}%` } })),
      )
    : null;

  let adBtn: HTMLButtonElement | null = null;
  if (info.coins > 0 && app.get().online && !info.unsynced) {
    adBtn = button(t('results.watchAd'), {
      kind: 'accent',
      testid: 'results-ad',
      onClick: async () => {
        adBtn!.disabled = true;
        const res = await ads.show('results');
        if (res.ok) {
          coinsEl.textContent = String(info.coins + res.coins);
          adBtn!.replaceWith(h('div', { class: 'ad-done', dataset: { testid: 'results-ad-done' } }, t('results.adDone', { coins: res.coins })));
        } else {
          adBtn!.replaceWith(h('div', { class: 'muted' }, t('results.adFailed')));
        }
      },
    });
  }

  const table =
    info.results && info.results.length > 1
      ? h(
          'table',
          { class: 'results-table' },
          h('thead', null, h('tr', null, h('th', null, t('common.player')), h('th', null, t('common.score')), h('th', null, t('common.kills')), h('th', null, t('results.deaths')))),
          h(
            'tbody',
            null,
            ...[...info.results]
              .sort((a, b) => b.score - a.score)
              .map((r) =>
                h('tr', { class: r.playerId === info.myId ? 'me' : '' }, h('td', null, r.name, r.won ? h('span', { class: 'chip win' }, t('results.winner')) : null), h('td', null, r.score.toLocaleString()), h('td', null, String(r.kills)), h('td', null, String(r.deaths))),
              ),
          ),
        )
      : null;

  const el = h(
    'div',
    { class: 'results-overlay', dataset: { testid: 'results' } },
    h(
      'div',
      { class: 'results-card glass' },
      h('div', { class: `results-title ${info.won ? 'win' : 'lose'}` }, info.mode === 'versus' ? (info.won ? t('results.victory') : t('results.defeat')) : t('results.title')),
      h('div', { class: 'stats' }, stat(t('common.score'), info.score.toLocaleString(), 'results-score'), stat(t('common.kills'), info.kills, 'results-kills'), stat(t('results.stageReached'), info.stage, 'results-stage')),
      h('div', { class: 'stats rewards' }, h('div', { class: 'stat' }, coinsEl, h('div', { class: 'stat-label' }, t('results.coinsEarned'))), stat(t('results.xpEarned'), info.xp, 'results-xp')),
      info.unsynced ? h('div', { class: 'notice offline' }, t('results.unsynced')) : info.verified === false ? h('div', { class: 'notice warn' }, t('results.notVerified')) : null,
      passEl,
      table,
      adBtn,
      h('div', { class: 'row' }, button(info.playAgainLabel ?? t('results.playAgain'), { kind: 'primary', big: true, testid: 'results-again', onClick: info.onPlayAgain }), button(t('results.menu'), { kind: 'ghost', big: true, testid: 'results-menu', onClick: info.onMenu })),
    ),
  );
  container.appendChild(el);
  return () => el.remove();
}
