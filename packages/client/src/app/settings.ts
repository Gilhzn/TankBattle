import { Store } from './store.js';
import { storageKey } from './storage.js';

export type Lang = 'en' | 'he';
export type Handedness = 'left' | 'right';
export type Difficulty = 'easy' | 'normal' | 'hard';

export interface Settings {
  lang: Lang;
  difficulty: Difficulty;
  handedness: Handedness;
  joystickSize: number; // px diameter
  sound: boolean;
  haptics: boolean;
  reducedMotion: boolean;
  nickname: string;
  soloLoadout: string[];
  mpLoadout: string[];
}

const KEY = storageKey('settings.v1');

function detectLang(): Lang {
  const langs = navigator.languages ?? [navigator.language];
  return langs.some((l) => l.toLowerCase().startsWith('he')) ? 'he' : 'en';
}

function defaults(): Settings {
  return {
    lang: detectLang(),
    difficulty: 'normal',
    handedness: 'left',
    joystickSize: 140,
    sound: true,
    haptics: true,
    reducedMotion: typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
    nickname: '',
    soloLoadout: [],
    mpLoadout: [],
  };
}

function load(): Settings {
  const d = defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return d;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...d, ...parsed };
  } catch {
    return d;
  }
}

export const settings = new Store<Settings>(load());

settings.subscribe((s) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
  applyDocumentSettings(s);
});

export function applyDocumentSettings(s: Settings = settings.get()): void {
  const html = document.documentElement;
  html.lang = s.lang;
  html.dir = s.lang === 'he' ? 'rtl' : 'ltr';
  html.classList.toggle('reduced-motion', s.reducedMotion);
  html.classList.toggle('hand-right', s.handedness === 'right');
  html.style.setProperty('--joystick-size', `${s.joystickSize}px`);
}

export function isCoarsePointer(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}

/** True when touch is a plausible primary input (coarse pointer or any touch points). */
export function hasTouchInput(): boolean {
  return isCoarsePointer() || (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) || 'ontouchstart' in window;
}
