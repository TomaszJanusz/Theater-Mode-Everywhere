import type { AppearancePreference } from '../src/appearance-preferences';
import type { Language } from '../src/language';

/** Shared capture and browser-test inputs. Content is fixture data, independent of UI locale. */
export interface Profile {
  name: string;
  globals: { locale: Language; backdrop: 'dark' | 'light'; reduceMotion: AppearancePreference };
  args: Record<string, string | number | boolean>;
  viewport: { width: number; height: number };
  reducedMotion: 'reduce' | 'no-preference';
  frames?: readonly number[];
}

export const BASE_VIEWPORT = { width: 640, height: 360 };
export const LOCALES = ['en', 'de', 'ar'] as const;
export const BACKDROPS = ['dark', 'light'] as const;

export function environment(locale: Language = 'en', backdrop: 'dark' | 'light' = 'dark'): Profile {
  return {
    name: `${locale}-${backdrop}`, globals: { locale, backdrop, reduceMotion: 'off' },
    args: {}, viewport: BASE_VIEWPORT, reducedMotion: 'reduce'
  };
}

export const LOCALE_ANCHORS: Record<string, (locale: Language) => Profile['args']> = {
  'player-volume-control--open': () => ({}),
  'player-speed-control--open': () => ({}),
  'player-control-button-tooltip--above': () => ({ tooltip: 'exitTheaterModeTooltip' }),
  // Arabic previously exercised backward seek, German forward seek.
  'player-hud--seek': locale => ({ direction: locale === 'ar' ? 'left' : 'right' }),
  'player-hud--text-only': () => ({ preset: 'onlyVideo' }),
  'player-caption-notice--status': locale => ({ detail: locale === 'ar' ? 'العربية' : 'Portugiesisch (Brasilien, automatisch erstellt)' }),
  'player-title-hud--overflow': (locale): Profile['args'] => locale === 'ar'
    ? { title: 'الفيلم الوثائقي الطويل عن السينما والضوء وتاريخ جهاز العرض في العالم', subtitle: 'الحلقة ٣' } : {},
  'player-auto-theater-notice--counting': () => ({})
};

const REDUCED = new Set(['player-hud--bass', 'player-title-hud--overflow', 'player-caption-notice--loading-to-result', 'player-auto-theater-notice--counting']);
export const NARROW_ANCHORS = ['player-control-button-tooltip--above', 'player-hud--text-only', 'player-caption-notice--status', 'player-title-hud--overflow'];

export function profilesFor(id: string): Profile[] {
  const profiles = BACKDROPS.map(backdrop => environment('en', backdrop));
  const content = LOCALE_ANCHORS[id];
  if (content) for (const locale of ['de', 'ar'] as const) {
    for (const backdrop of BACKDROPS) profiles.push({ ...environment(locale, backdrop), args: content(locale) });
  }
  if (REDUCED.has(id)) for (const backdrop of BACKDROPS) {
    const profile = environment('en', backdrop);
    profiles.push({ ...profile, name: `reduced-${backdrop}`, globals: { ...profile.globals, reduceMotion: 'on' }, frames: [0.5] });
  }
  if (NARROW_ANCHORS.includes(id)) profiles.push({
    ...environment('de'), name: 'narrow-de', viewport: { width: 320, height: 360 }, args: content?.('de') ?? {}, frames: [0.5]
  });
  return profiles;
}

export function storyUrl(base: string, id: string, profile: Profile): string {
  const url = new URL('/iframe.html', base);
  url.searchParams.set('id', id);
  url.searchParams.set('viewMode', 'story');
  url.searchParams.set('globals', Object.entries(profile.globals).map(([key, value]) => `${key}:${value}`).join(';'));
  if (Object.keys(profile.args).length) url.searchParams.set('args', Object.entries(profile.args).filter(([, value]) => typeof value !== 'string' || /^[a-zA-Z0-9 _-]*$/.test(value)).map(([key, value]) => `${key}:${value}`).join(';'));
  return url.href;
}

declare global {
  interface Window {
    __storyState?: { globals: Record<string, unknown>; args: Record<string, unknown> };
  }
}

