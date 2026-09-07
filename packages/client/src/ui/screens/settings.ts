import { Api, errorMessage } from '../../app/api.js';
import { h } from '../../app/h.js';
import { navigate } from '../../app/router.js';
import { settings, type Difficulty, type Handedness } from '../../app/settings.js';
import { app, toast } from '../../app/store.js';
import { setLang, t } from '../../i18n/index.js';
import { button, labelled, panel, screenShell, toggle } from '../components.js';

export function settingsScreen(root: HTMLElement): () => void {
  const shell = screenShell(t('settings.title'), { back: '/', testid: 'settings' });
  root.appendChild(shell.el);
  const s = settings.get();

  const seg = <T extends string>(options: Array<{ id: T; label: string; testid?: string }>, cur: T, onChange: (v: T) => void): HTMLElement =>
    h(
      'div',
      { class: 'seg', attrs: { role: 'radiogroup' } },
      ...options.map((o) =>
        h('button', { class: `seg-btn ${o.id === cur ? 'active' : ''}`, type: 'button', dataset: o.testid ? { testid: o.testid } : undefined, attrs: { role: 'radio', 'aria-checked': o.id === cur ? 'true' : 'false' }, onclick: () => onChange(o.id) }, o.label),
      ),
    );

  const nick = h('input', { class: 'input', type: 'text', maxLength: 16, minLength: 2, value: app.get().user?.nickname ?? s.nickname, dataset: { testid: 'settings-nickname' }, autocomplete: 'off' });
  const saveNick = button(t('common.save'), {
    kind: 'primary',
    testid: 'settings-save-nickname',
    onClick: async () => {
      const value = nick.value.trim();
      if (value.length < 2) return;
      settings.set({ nickname: value });
      if (app.get().online) {
        try {
          const res = await Api.patchMe({ nickname: value });
          app.set({ user: res.user });
        } catch (e) {
          toast(errorMessage(e), 'error');
          return;
        }
      }
      toast(t('settings.saved'), 'success');
    },
  });
  const sizeVal = h('span', { class: 'muted' }, `${s.joystickSize}px`);
  const size = h('input', { class: 'range', type: 'range', min: 100, max: 220, step: 10, value: String(s.joystickSize), dataset: { testid: 'settings-joystick-size' }, oninput: () => { settings.set({ joystickSize: Number(size.value) }); sizeVal.textContent = `${size.value}px`; } });

  shell.body.append(
    panel(
      h('h2', null, t('settings.language')),
      seg(
        [
          { id: 'en', label: t('settings.english'), testid: 'lang-en' },
          { id: 'he', label: t('settings.hebrew'), testid: 'lang-he' },
        ],
        s.lang,
        (lang) => {
          settings.set({ lang });
          setLang(lang);
          navigate('/settings');
        },
      ),
    ),
    panel(
      h('h2', null, t('settings.nickname')),
      h('div', { class: 'join-row' }, nick, saveNick),
      h('small', { class: 'muted' }, t('settings.nicknameHint')),
    ),
    panel(
      h('h2', null, t('settings.controls')),
      labelled(t('settings.difficulty'), seg<Difficulty>([
        { id: 'easy', label: t('settings.easy'), testid: 'diff-easy' },
        { id: 'normal', label: t('settings.normal'), testid: 'diff-normal' },
        { id: 'hard', label: t('settings.hard'), testid: 'diff-hard' },
      ], s.difficulty, (difficulty) => { settings.set({ difficulty }); navigate('/settings'); }), t('settings.difficultyHint')),
      labelled(t('settings.handedness'), seg<Handedness>([{ id: 'left', label: t('settings.left'), testid: 'hand-left' }, { id: 'right', label: t('settings.right'), testid: 'hand-right' }], s.handedness, (handedness) => { settings.set({ handedness }); navigate('/settings'); })),
      labelled(t('settings.joystickSize'), h('div', { class: 'row' }, size, sizeVal)),
      h('p', { class: 'muted small' }, t('settings.keyboard')),
    ),
    panel(
      h('label', { class: 'field row-field' }, h('span', null, t('settings.sound')), toggle(s.sound, (v) => settings.set({ sound: v }), 'settings-sound')),
      h('label', { class: 'field row-field' }, h('span', null, t('settings.haptics')), toggle(s.haptics, (v) => settings.set({ haptics: v }), 'settings-haptics')),
      h('label', { class: 'field row-field' }, h('span', null, t('settings.reducedMotion')), toggle(s.reducedMotion, (v) => settings.set({ reducedMotion: v }), 'settings-reduced-motion')),
    ),
    h('p', { class: 'muted small center-text' }, t('settings.version', { v: __APP_VERSION__ })),
  );
  return () => shell.el.remove();
}
