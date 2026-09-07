import { Api, errorMessage, refreshMe, setToken, type AuthResult } from '../../app/api.js';
import { h, clear } from '../../app/h.js';
import { navigate } from '../../app/router.js';
import { app, toast } from '../../app/store.js';
import { getLang, t } from '../../i18n/index.js';
import { awaitBoot, button, offlineNotice, panel, screenShell, spinner } from '../components.js';

/** Google's own sign-in library, loaded only if this deployment has a client id. */
interface GoogleIdentity {
  accounts: {
    id: {
      initialize(o: { client_id: string; callback: (r: { credential: string }) => void; auto_select?: boolean }): void;
      renderButton(el: HTMLElement, o: Record<string, unknown>): void;
    };
  };
}

const GSI_SRC = 'https://accounts.google.com/gsi/client';

/** Loads Google's script once. Resolves false if it cannot be reached (offline, blocked). */
function loadGoogleScript(): Promise<boolean> {
  const w = window as unknown as { google?: GoogleIdentity };
  if (w.google?.accounts?.id) return Promise.resolve(true);
  return new Promise((resolve) => {
    const existing = document.querySelector(`script[src="${GSI_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(true));
      existing.addEventListener('error', () => resolve(false));
      return;
    }
    const s = document.createElement('script');
    s.src = GSI_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
}

/** The browser's guess at the player's country, used only to place them on the national ladder. */
function guessCountry(): string | undefined {
  try {
    const region = new Intl.Locale(navigator.language).region;
    return region && /^[A-Z]{2}$/.test(region) ? region : undefined;
  } catch {
    return undefined;
  }
}

export function signInScreen(root: HTMLElement): () => void {
  const shell = screenShell(t('auth.title'), { back: '/', testid: 'signin' });
  root.appendChild(shell.el);
  const body = h('div', { dataset: { testid: 'signin-body' } });
  shell.body.appendChild(body);
  let disposed = false;

  const finish = async (res: AuthResult): Promise<void> => {
    setToken(res.token);
    await refreshMe();
    toast(t('auth.signedIn'), 'success');
    navigate(res.needsNickname ? '/settings' : '/');
  };

  const emailPanel = (delivers: boolean): HTMLElement => {
    const email = h('input', {
      class: 'input',
      dataset: { testid: 'signin-email' },
      attrs: { type: 'email', inputmode: 'email', placeholder: t('auth.emailPlaceholder'), autocomplete: 'email', autocapitalize: 'off', spellcheck: 'false' },
    }) as HTMLInputElement;
    const code = h('input', {
      class: 'input',
      dataset: { testid: 'signin-code' },
      attrs: { type: 'text', inputmode: 'numeric', placeholder: '000000', maxlength: '6', autocomplete: 'one-time-code' },
    }) as HTMLInputElement;
    const codeRow = h('div', { class: 'field' }, h('span', { class: 'field-label' }, t('auth.codeLabel')), code);
    codeRow.hidden = true;

    const verifyBtn = button(t('auth.verify'), {
      kind: 'primary',
      big: true,
      testid: 'signin-verify',
      onClick: () => {
        void (async () => {
          try {
            await finish(await Api.emailVerify(email.value.trim(), code.value.trim(), guessCountry()));
          } catch (e) {
            toast(errorMessage(e), 'error');
          }
        })();
      },
    });
    verifyBtn.hidden = true;

    const sendBtn = button(t('auth.sendCode'), {
      kind: 'secondary',
      big: true,
      testid: 'signin-send-code',
      onClick: () => {
        void (async () => {
          try {
            await Api.emailStart(email.value.trim(), getLang());
            if (disposed) return;
            toast(t('auth.codeSent', { email: email.value.trim() }), 'success');
            codeRow.hidden = false;
            verifyBtn.hidden = false;
            code.focus();
          } catch (e) {
            toast(errorMessage(e), 'error');
          }
        })();
      },
    });

    return panel(
      h('h2', null, t('auth.emailLabel')),
      h('p', { class: 'muted' }, t('auth.noTempMail')),
      // Honest about the dev fallback rather than claiming a mail was sent that was not.
      delivers ? '' : h('p', { class: 'warn-note' }, t('auth.devMailNotice')),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, t('auth.emailLabel')), email),
      sendBtn,
      codeRow,
      verifyBtn,
    );
  };

  const load = async (): Promise<void> => {
    if (!(await awaitBoot())) {
      body.appendChild(offlineNotice());
      return;
    }
    body.appendChild(spinner());
    let methods: Awaited<ReturnType<typeof Api.authMethods>>;
    try {
      methods = await Api.authMethods();
    } catch (e) {
      clear(body);
      body.appendChild(panel(h('p', null, errorMessage(e))));
      return;
    }
    if (disposed) return;
    clear(body);

    body.append(panel(h('p', { class: 'muted' }, t('auth.why'))));

    if (methods.google && methods.googleClientId) {
      const holder = h('div', { class: 'gsi-holder', dataset: { testid: 'signin-google' } });
      body.append(panel(h('h2', null, t('auth.google')), holder));
      void loadGoogleScript().then((ok) => {
        if (!ok || disposed) return;
        const g = (window as unknown as { google?: GoogleIdentity }).google;
        if (!g) return;
        g.accounts.id.initialize({
          client_id: methods.googleClientId!,
          callback: (r) => {
            void (async () => {
              try {
                await finish(await Api.googleSignIn(r.credential, guessCountry()));
              } catch (e) {
                toast(errorMessage(e), 'error');
              }
            })();
          },
        });
        g.accounts.id.renderButton(holder, { theme: 'filled_black', size: 'large', shape: 'pill', width: 280 });
      });
    }

    body.append(emailPanel(methods.emailDelivers));
    body.append(panel(button(t('auth.playAsGuest'), { kind: 'ghost', testid: 'signin-guest', onClick: () => navigate('/') })));
  };

  void load();
  return () => {
    disposed = true;
    shell.el.remove();
  };
}
