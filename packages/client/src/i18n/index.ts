import { en, type TranslationKey } from './en.js';
import { he } from './he.js';

export type Lang = 'en' | 'he';
export type { TranslationKey };

const dictionaries: Record<Lang, Partial<Record<TranslationKey, string>>> = { en, he };

let current: Lang = 'en';
const listeners = new Set<(lang: Lang) => void>();

export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang): void {
  if (lang === current) return;
  current = lang;
  for (const l of [...listeners]) l(lang);
}

export function onLangChange(fn: (lang: Lang) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function hasKey(key: string): key is TranslationKey {
  return key in en;
}

/** Translate `key`, interpolating `{param}` placeholders; falls back to English, then to the key itself. */
export function t(key: TranslationKey | string, params?: Record<string, string | number>, lang: Lang = current): string {
  const dict = dictionaries[lang] ?? en;
  let s: string | undefined = dict[key as TranslationKey];
  if (s === undefined) s = en[key as TranslationKey];
  if (s === undefined) s = key;
  if (params) {
    for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v));
  }
  return s;
}

/** Catalog item name/description with i18n fallback to the catalog text. */
export function itemName(sku: string, fallback: string): string {
  const key = `item.${sku}`;
  return hasKey(key) ? t(key) : fallback;
}
export function itemDesc(sku: string, fallback: string): string {
  const key = `item.desc.${sku}`;
  return hasKey(key) ? t(key) : fallback;
}
