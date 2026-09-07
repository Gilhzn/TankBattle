import { Api, errorMessage, type LeaderEntry } from '../../app/api.js';
import { h, clear } from '../../app/h.js';
import { app, toast } from '../../app/store.js';
import { t } from '../../i18n/index.js';
import { emptyState, offlineNotice, screenShell, spinner, tabs } from '../components.js';

type Mode = 'solo' | 'coop' | 'versus';

export function leaderboardScreen(root: HTMLElement): () => void {
  const shell = screenShell(t('lb.title'), { back: '/', testid: 'leaderboard' });
  root.appendChild(shell.el);
  let mode: Mode = 'solo';
  const list = h('div', { class: 'lb-list', dataset: { testid: 'lb-list' } });
  let disposed = false;

  const row = (e: LeaderEntry, me = false): HTMLElement =>
    h('div', { class: `lb-row ${me ? 'me' : ''} ${e.rank <= 3 ? `top${e.rank}` : ''}` }, h('span', { class: 'lb-rank' }, `#${e.rank}`), h('span', { class: 'lb-name' }, e.name), h('span', { class: 'lb-stage' }, `${t('common.stage')} ${e.stage}`), h('span', { class: 'lb-score' }, e.score.toLocaleString()));

  const load = async (): Promise<void> => {
    clear(list);
    if (!app.get().online) {
      list.appendChild(offlineNotice());
      return;
    }
    list.appendChild(spinner());
    try {
      const res = await Api.leaderboard(mode);
      if (disposed) return;
      clear(list);
      if (!res.entries.length) list.appendChild(emptyState(t('lb.empty')));
      for (const e of res.entries) list.appendChild(row(e, res.me?.name === e.name && res.me?.rank === e.rank));
      if (res.me && !res.entries.some((e) => e.rank === res.me!.rank)) list.append(h('div', { class: 'muted' }, t('lb.me')), row(res.me, true));
    } catch (e) {
      clear(list);
      toast(errorMessage(e), 'error');
      list.appendChild(emptyState(errorMessage(e)));
    }
  };

  shell.body.append(
    tabs<Mode>(
      [
        { id: 'solo', label: t('lb.solo'), testid: 'lb-tab-solo' },
        { id: 'coop', label: t('lb.coop'), testid: 'lb-tab-coop' },
        { id: 'versus', label: t('lb.versus'), testid: 'lb-tab-versus' },
      ],
      mode,
      (m) => {
        mode = m;
        void load();
      },
    ),
    list,
  );
  void load();
  return () => {
    disposed = true;
    shell.el.remove();
  };
}
