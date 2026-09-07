import { type TranslationKey } from './en.js';
export type Lang = 'en' | 'he';
export type { TranslationKey };
export declare function getLang(): Lang;
export declare function setLang(lang: Lang): void;
export declare function onLangChange(fn: (lang: Lang) => void): () => void;
export declare function hasKey(key: string): key is TranslationKey;
/** Translate `key`, interpolating `{param}` placeholders; falls back to English, then to the key itself. */
export declare function t(key: TranslationKey | string, params?: Record<string, string | number>, lang?: Lang): string;
/** Catalog item name/description with i18n fallback to the catalog text. */
export declare function itemName(sku: string, fallback: string): string;
export declare function itemDesc(sku: string, fallback: string): string;
//# sourceMappingURL=index.d.ts.map