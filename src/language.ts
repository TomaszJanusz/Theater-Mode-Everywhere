export const LANGUAGE_STORAGE_KEY = 'language';
export const DEFAULT_LANGUAGE = 'automatic';

/** Catalog identifiers also serve as the Settings menu's source of truth. */
export const LANGUAGES = [
  { locale: 'en', name: 'English' },
  { locale: 'pl', name: 'Polski' },
  { locale: 'de', name: 'Deutsch' },
  { locale: 'es', name: 'Español' },
  { locale: 'fr', name: 'Français' },
  { locale: 'it', name: 'Italiano' },
  { locale: 'pt_BR', name: 'Português (Brasil)' },
  { locale: 'ru', name: 'Русский' },
  { locale: 'uk', name: 'Українська' },
  { locale: 'zh_CN', name: '简体中文' },
  { locale: 'ja', name: '日本語' },
  { locale: 'ko', name: '한국어' },
  { locale: 'ar', name: 'العربية' }
] as const;

export type Locale = typeof LANGUAGES[number]['locale'];
export type Language = Locale | typeof DEFAULT_LANGUAGE;

export function resolveLanguage(value: unknown): Language {
  return LANGUAGES.find(({ locale }) => locale === value)?.locale ?? DEFAULT_LANGUAGE;
}
