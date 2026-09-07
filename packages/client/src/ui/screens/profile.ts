import { ARENAS, RATING_BAND, ratingBand } from '@tank/shared';
import { Api, errorMessage, type PlayerProfileDTO } from '../../app/api.js';
import { h, clear } from '../../app/h.js';
import { navigate } from '../../app/router.js';
import { app, toast } from '../../app/store.js';
import { t } from '../../i18n/index.js';
import { button, emptyState, offlineNotice, panel, screenShell, spinner, tankPreview } from '../components.js';

/** A rank as "#12 of 340", or a dash while the player is still unrated. */
function rankText(r: { position: number; of: number }): string {
  if (!r.position) return '—';
  return t('profile.rankOf', { position: r.position, of: r.of });
}

function stat(label: string, value: string, cls = ''): HTMLElement {
  return h('div', { class: `stat ${cls}` }, h('span', { class: 'stat-value' }, value), h('span', { class: 'stat-label' }, label));
}

/** Flag emoji from an ISO country code, or empty when we do not know the country. */
function flag(code: string): string {
  if (!/^[A-Za-z]{2}$/.test(code)) return '';
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

export function profileScreen(root: HTMLElement, params: Record<string, string> = {}): () => void {
  // The router has already decoded the segment; decoding again would mangle a literal '%'.
  const nickname = params.nickname || null;
  const shell = screenShell(t('profile.title'), { back: nickname ? '/friends' : '/', testid: 'profile' });
  root.appendChild(shell.el);
  const body = h('div', { class: 'profile-body', dataset: { testid: 'profile-body' } });
  shell.body.appendChild(body);
  let disposed = false;

  const render = (p: PlayerProfileDTO): void => {
    clear(body);
    const r = p.rating;
    const band = ratingBand(r.rating);
    const nextBandAt = (band + 1) * RATING_BAND;
    const arenaName = ARENAS[band % ARENAS.length]?.name ?? '';

    body.append(
      panel(
        h(
          'div',
          { class: 'profile-head' },
          tankPreview(p.skin, 72),
          h(
            'div',
            { class: 'profile-id' },
            h('h2', { class: 'profile-name', dataset: { testid: 'profile-name' } }, p.nickname),
            h(
              'div',
              { class: 'profile-meta muted' },
              h('span', { class: `presence ${p.presence.state}` }),
              h('span', null, t(`friends.state.${p.presence.state}`)),
              p.country ? h('span', { class: 'profile-country' }, `${flag(p.country)} ${p.country}`) : '',
            ),
          ),
        ),
      ),

      h('h2', { class: 'section-title' }, t('profile.ranked')),
      panel(
        h(
          'div',
          { class: `tier-banner tier-${r.tier}`, dataset: { testid: 'profile-tier' } },
          h('span', { class: 'tier-name' }, t(`tier.${r.tier}`)),
          h('span', { class: 'tier-rating' }, String(r.rating)),
        ),
        h(
          'div',
          { class: 'stat-grid' },
          stat(t('profile.wins'), String(r.wins), 'good'),
          stat(t('profile.losses'), String(r.losses), 'bad'),
          stat(t('profile.matches'), String(r.matches)),
          stat(t('profile.best'), String(r.best)),
        ),
        h(
          'div',
          { class: 'stat-grid' },
          stat(t('profile.worldRank'), rankText(r.world)),
          stat(r.countryCode ? t('profile.countryRank', { country: r.countryCode }) : t('profile.countryRankUnknown'), rankText(r.country)),
        ),
        // The arena changes every 100 points, so it is worth saying which one and what is next.
        h('p', { class: 'muted arena-note' }, t('profile.arenaNote', { arena: arenaName, points: Math.max(0, nextBandAt - r.rating) })),
      ),

      h('h2', { class: 'section-title' }, t('profile.campaign')),
      panel(
        h(
          'div',
          { class: 'stat-grid' },
          stat(t('profile.bestScore'), p.stats.bestScore.toLocaleString()),
          stat(t('profile.bestStage'), String(p.stats.bestStage)),
          stat(t('profile.kills'), p.stats.kills.toLocaleString()),
          stat(t('profile.played'), String(p.stats.matches)),
        ),
      ),
    );

    if (p.isSelf) {
      body.append(panel(button(t('profile.viewFriends'), { kind: 'secondary', big: true, testid: 'profile-friends', onClick: () => navigate('/friends') })));
    } else if (!p.isFriend) {
      body.append(
        panel(
          button(t('friends.add'), {
            kind: 'primary',
            big: true,
            testid: 'profile-add-friend',
            onClick: () => {
              void (async () => {
                try {
                  const res = await Api.friendRequest(p.nickname);
                  toast(res.status === 'accepted' ? t('friends.nowFriends', { name: p.nickname }) : t('friends.requestSent', { name: p.nickname }), 'success');
                } catch (e) {
                  toast(errorMessage(e), 'error');
                }
              })();
            },
          }),
        ),
      );
    }
  };

  const load = async (): Promise<void> => {
    if (!app.get().online) {
      clear(body);
      body.appendChild(offlineNotice(t('profile.offline')));
      return;
    }
    clear(body);
    body.appendChild(spinner());
    try {
      const p = nickname ? await Api.playerByNickname(nickname) : await Api.myProfile();
      if (disposed) return;
      render(p);
    } catch (e) {
      if (disposed) return;
      clear(body);
      body.appendChild(emptyState(errorMessage(e)));
    }
  };

  void load();
  return () => {
    disposed = true;
    shell.el.remove();
  };
}
