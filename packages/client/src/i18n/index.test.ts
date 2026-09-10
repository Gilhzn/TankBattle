import { describe, expect, it } from 'vitest';
import { t, setLang, getLang, itemName } from './index.js';
import { en } from './en.js';
import { he } from './he.js';

describe('i18n', () => {
  it('interpolates params', () => {
    expect(t('menu.tier', { tier: 7 })).toBe('Tier 7');
    expect(t('lobby.reconnecting', { n: 3 }, 'en')).toBe('Reconnecting… (attempt 3)');
  });
  it('returns Hebrew text when lang is he', () => {
    expect(t('menu.playSolo', undefined, 'he')).toBe('משחק יחיד');
    expect(t('menu.playSolo', undefined, 'he')).not.toBe(en['menu.playSolo']);
  });
  it('falls back to English for missing Hebrew keys, then to the key itself', () => {
    const missing = Object.keys(en).find((k) => !(k in he));
    // he is a partial dictionary: whatever is missing must resolve to the English string
    if (missing) expect(t(missing, undefined, 'he')).toBe(en[missing as keyof typeof en]);
    expect(t('no.such.key', undefined, 'he')).toBe('no.such.key');
    expect(t('no.such.key')).toBe('no.such.key');
  });
  it('switches the current language', () => {
    setLang('he');
    expect(getLang()).toBe('he');
    expect(t('common.back')).toBe('חזרה');
    setLang('en');
    expect(t('common.back')).toBe('Back');
  });
  it('resolves item names with a fallback', () => {
    expect(itemName('boost_grenade', 'x')).toBe('Pulse Charge');
    expect(itemName('unknown_sku', 'Fallback')).toBe('Fallback');
  });
  it('has a Hebrew translation for every English key', () => {
    const missing = Object.keys(en).filter((k) => !(k in he));
    expect(missing).toEqual([]);
  });
});
