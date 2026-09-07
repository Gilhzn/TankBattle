import type { FriendDTO, FriendRequestDTO } from '@tank/shared';
import { Api, errorMessage } from '../../app/api.js';
import { h, clear } from '../../app/h.js';
import { navigate } from '../../app/router.js';
import { app, toast } from '../../app/store.js';
import { t } from '../../i18n/index.js';
import { button, emptyState, offlineNotice, panel, screenShell, spinner, tabs } from '../components.js';

type Tab = 'friends' | 'requests' | 'add';

/** "3 minutes ago" for a last-seen stamp, in whichever language is active. */
function agoLabel(ms: number): string {
  if (!ms) return t('friends.longAgo');
  const mins = Math.floor((Date.now() - ms) / 60_000);
  if (mins < 1) return t('friends.justNow');
  if (mins < 60) return t('friends.minutesAgo', { n: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t('friends.hoursAgo', { n: hours });
  return t('friends.daysAgo', { n: Math.floor(hours / 24) });
}

export function friendsScreen(root: HTMLElement): () => void {
  const shell = screenShell(t('friends.title'), { back: '/', testid: 'friends' });
  root.appendChild(shell.el);
  let tab: Tab = 'friends';
  let disposed = false;
  let data: { friends: FriendDTO[]; incoming: FriendRequestDTO[]; outgoing: FriendRequestDTO[] } = { friends: [], incoming: [], outgoing: [] };

  const body = h('div', { class: 'friends-body', dataset: { testid: 'friends-body' } });

  /** Runs an action, then refreshes; surfaces the server's own message on failure. */
  const act = async (fn: () => Promise<unknown>, ok?: string): Promise<void> => {
    try {
      await fn();
      if (ok) toast(ok, 'success');
      await load();
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  const presenceDot = (f: FriendDTO): HTMLElement =>
    h('span', { class: `presence ${f.state}`, attrs: { title: t(`friends.state.${f.state}`) } });

  const friendRow = (f: FriendDTO): HTMLElement =>
    h(
      'div',
      { class: 'friend-row', dataset: { testid: `friend-${f.nickname}` } },
      h(
        'button',
        { class: 'friend-main', type: 'button', onclick: () => navigate(`/player/${encodeURIComponent(f.nickname)}`) },
        presenceDot(f),
        h(
          'span',
          { class: 'friend-text' },
          h('span', { class: 'friend-name' }, f.nickname),
          h('span', { class: 'friend-sub muted' }, f.state === 'offline' ? agoLabel(f.lastSeen) : t(`friends.state.${f.state}`)),
        ),
        h('span', { class: 'friend-rating' }, f.rating ? String(f.rating) : '—'),
      ),
      button('✕', {
        kind: 'ghost',
        testid: `friend-remove-${f.nickname}`,
        onClick: () => void act(() => Api.friendRemove(f.id), t('friends.removed')),
      }),
    );

  const requestRow = (r: FriendRequestDTO, kind: 'incoming' | 'outgoing'): HTMLElement =>
    h(
      'div',
      { class: 'friend-row', dataset: { testid: `request-${r.user.nickname}` } },
      h('span', { class: 'friend-text' }, h('span', { class: 'friend-name' }, r.user.nickname), h('span', { class: 'friend-sub muted' }, `${r.user.rating || '—'}`)),
      kind === 'incoming'
        ? h(
            'span',
            { class: 'row-actions' },
            button(t('friends.accept'), { kind: 'primary', testid: `accept-${r.user.nickname}`, onClick: () => void act(() => Api.friendAccept(r.id), t('friends.nowFriends', { name: r.user.nickname })) }),
            button(t('friends.decline'), { kind: 'ghost', onClick: () => void act(() => Api.friendDecline(r.id)) }),
          )
        : button(t('friends.cancel'), { kind: 'ghost', onClick: () => void act(() => Api.friendCancel(r.id)) }),
    );

  const renderFriends = (): void => {
    if (!data.friends.length) {
      body.append(emptyState(t('friends.none')));
      return;
    }
    body.append(panel(...data.friends.map(friendRow)));
  };

  const renderRequests = (): void => {
    const { incoming, outgoing } = data;
    if (!incoming.length && !outgoing.length) {
      body.append(emptyState(t('friends.noRequests')));
      return;
    }
    if (incoming.length) body.append(h('h2', { class: 'section-title' }, t('friends.incoming')), panel(...incoming.map((r) => requestRow(r, 'incoming'))));
    if (outgoing.length) body.append(h('h2', { class: 'section-title' }, t('friends.outgoing')), panel(...outgoing.map((r) => requestRow(r, 'outgoing'))));
  };

  const renderAdd = (): void => {
    const input = h('input', {
      class: 'input',
      dataset: { testid: 'friend-nickname' },
      attrs: { type: 'text', placeholder: t('friends.nicknamePlaceholder'), maxlength: '16', autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false' },
    }) as HTMLInputElement;
    const send = (): void => {
      const nickname = input.value.trim();
      if (nickname.length < 2) return;
      void act(async () => {
        const res = await Api.friendRequest(nickname);
        input.value = '';
        toast(res.status === 'accepted' ? t('friends.nowFriends', { name: nickname }) : t('friends.requestSent', { name: nickname }), 'success');
      });
    };
    input.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') send();
    });

    const share = button(t('friends.shareWhatsapp'), {
      kind: 'confirm',
      big: true,
      testid: 'friend-invite-whatsapp',
      onClick: () => {
        void (async () => {
          try {
            const invite = await Api.friendInvite();
            // Opened rather than fetched: wa.me hands the message to WhatsApp and lets the player
            // pick the contact themselves, so the game never touches anyone's phone number.
            window.open(invite.whatsappUrl, '_blank', 'noopener');
          } catch (e) {
            toast(errorMessage(e), 'error');
          }
        })();
      },
    });

    const copy = button(t('friends.copyLink'), {
      kind: 'ghost',
      testid: 'friend-invite-copy',
      onClick: () => {
        void (async () => {
          try {
            const invite = await Api.friendInvite();
            await navigator.clipboard.writeText(invite.url);
            toast(t('friends.linkCopied'), 'success');
          } catch (e) {
            toast(errorMessage(e), 'error');
          }
        })();
      },
    });

    body.append(
      panel(
        h('h2', null, t('friends.byNickname')),
        h('p', { class: 'muted' }, t('friends.byNicknameHint')),
        h('div', { class: 'join-row' }, input, button(t('friends.send'), { kind: 'primary', testid: 'friend-send', onClick: send })),
      ),
      panel(h('h2', null, t('friends.inviteTitle')), h('p', { class: 'muted' }, t('friends.inviteHint')), share, copy),
    );
  };

  const render = (): void => {
    clear(body);
    if (tab === 'friends') renderFriends();
    else if (tab === 'requests') renderRequests();
    else renderAdd();
  };

  const load = async (): Promise<void> => {
    if (!app.get().online) {
      clear(body);
      body.appendChild(offlineNotice(t('friends.offline')));
      return;
    }
    if (tab === 'add') {
      render();
      return;
    }
    clear(body);
    body.appendChild(spinner());
    try {
      data = await Api.friends();
      if (disposed) return;
      render();
    } catch (e) {
      if (disposed) return;
      clear(body);
      body.appendChild(emptyState(errorMessage(e)));
    }
  };

  const tabBar = h('div', { dataset: { testid: 'friends-tabs' } });
  const drawTabs = (): void => {
    clear(tabBar);
    const pending = data.incoming.length;
    tabBar.appendChild(
      tabs<Tab>(
        [
          { id: 'friends', label: t('friends.tabFriends'), testid: 'friends-tab-list' },
          { id: 'requests', label: pending ? `${t('friends.tabRequests')} (${pending})` : t('friends.tabRequests'), testid: 'friends-tab-requests' },
          { id: 'add', label: t('friends.tabAdd'), testid: 'friends-tab-add' },
        ],
        tab,
        (id) => {
          tab = id;
          drawTabs();
          void load();
        },
      ),
    );
  };
  drawTabs();

  shell.body.append(tabBar, body);
  void load().then(() => !disposed && drawTabs());

  // Presence goes stale quickly, so the list refreshes while it is open.
  const poll = window.setInterval(() => {
    if (tab !== 'add' && app.get().online) void load().then(() => !disposed && drawTabs());
  }, 20_000);

  return () => {
    disposed = true;
    clearInterval(poll);
    shell.el.remove();
  };
}
