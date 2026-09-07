import { Api, errorMessage } from '../../app/api.js';
import { h, clear } from '../../app/h.js';
import { navigate } from '../../app/router.js';
import { app, toast } from '../../app/store.js';
import { t } from '../../i18n/index.js';
import { awaitBoot, button, emptyState, offlineNotice, panel, screenShell, spinner } from '../components.js';

/**
 * Where a shared invite link lands.
 *
 * Someone opening this arrived from WhatsApp and may never have played before, so it explains what
 * happened in a sentence and sends the friend request for them rather than asking them to find the
 * friends screen and type a nickname they would have to read off the message.
 */
export function inviteScreen(root: HTMLElement, params: Record<string, string> = {}): () => void {
  const shell = screenShell(t('invite.title'), { back: '/', testid: 'invite' });
  root.appendChild(shell.el);
  const body = h('div', { dataset: { testid: 'invite-body' } });
  shell.body.appendChild(body);
  let disposed = false;

  const done = (message: string, nickname: string): void => {
    clear(body);
    body.append(
      panel(
        h('h2', null, message),
        h('p', { class: 'muted' }, t('invite.thenWhat', { name: nickname })),
        button(t('invite.openFriends'), { kind: 'primary', big: true, testid: 'invite-friends', onClick: () => navigate('/friends') }),
        button(t('common.menu'), { kind: 'ghost', onClick: () => navigate('/') }),
      ),
    );
  };

  const run = async (): Promise<void> => {
    const code = params.code;
    if (!code) {
      body.appendChild(emptyState(t('invite.bad')));
      return;
    }
    if (!(await awaitBoot())) {
      body.appendChild(offlineNotice(t('invite.offline')));
      return;
    }
    body.appendChild(spinner());
    try {
      const res = await Api.friendInviteAccept(code);
      if (disposed) return;
      const message =
        res.status === 'already_friends'
          ? t('invite.alreadyFriends', { name: res.nickname })
          : res.status === 'accepted'
            ? t('friends.nowFriends', { name: res.nickname })
            : t('friends.requestSent', { name: res.nickname });
      done(message, res.nickname);
    } catch (e) {
      if (disposed) return;
      clear(body);
      toast(errorMessage(e), 'error');
      body.append(panel(h('h2', null, t('invite.failed')), h('p', { class: 'muted' }, errorMessage(e)), button(t('common.menu'), { kind: 'primary', onClick: () => navigate('/') })));
    }
  };

  void run();
  return () => {
    disposed = true;
    shell.el.remove();
  };
}
