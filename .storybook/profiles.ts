import type { AppearancePreference } from '../src/appearance-preferences';
import type { Language } from '../src/language';

export type Timeline = 'enter' | 'hold' | 'leave' | 'live';
export interface Moment { timeline: Exclude<Timeline, 'live'>; frame: number }

/** Shared capture and browser-test inputs. Content is fixture data, independent of UI locale. */
export interface Profile {
  name: string;
  globals: { locale: Language; backdrop: 'dark' | 'light'; reduceMotion: AppearancePreference; timeline: Timeline };
  args: Record<string, string | number | boolean>;
  viewport: { width: number; height: number };
  reducedMotion: 'reduce' | 'no-preference';
  frames?: readonly number[];
  moments?: readonly Moment[];
}

export const BASE_VIEWPORT = { width: 640, height: 360 };
export const LOCALES = ['en', 'de', 'ar'] as const;
export const BACKDROPS = ['dark', 'light'] as const;

export function environment(locale: Language = 'en', backdrop: 'dark' | 'light' = 'dark'): Profile {
  return {
    name: `${locale}-${backdrop}`, globals: { locale, backdrop, reduceMotion: 'off', timeline: 'hold' },
    args: {}, viewport: BASE_VIEWPORT, reducedMotion: 'reduce'
  };
}

export const LOCALE_ANCHORS: Record<string, (locale: Language) => Profile['args']> = {
  'components-volume-control--open': () => ({}),
  'components-speed-control--open': () => ({}),
  'components-control-button-tooltip--above': () => ({ tooltip: 'exitTheaterModeTooltip' }),
  // Arabic previously exercised backward seek, German forward seek.
  'components-hud--seek': locale => ({ direction: locale === 'ar' ? 'left' : 'right' }),
  'components-hud--text-only': () => ({ preset: 'onlyVideo' }),
  // The pictogram has no words, so right-to-left only proves the play triangle keeps pointing forward.
  'components-hud--playback': () => ({}),
  'components-caption-notice--status': locale => ({ detail: locale === 'ar' ? 'العربية' : 'Portugiesisch (Brasilien, automatisch erstellt)' }),
  'components-language-notice--merged': () => ({}),
  'components-title-hud--overflow': (locale): Profile['args'] => locale === 'ar'
    ? { title: 'الفيلم الوثائقي الطويل عن السينما والضوء وتاريخ جهاز العرض في العالم', subtitle: 'الحلقة ٣' } : {},
  'components-auto-theater-notice--counting': () => ({})
};

/** Language notice stories whose last step morphs the plate: shot at several fractions of the morph. */
const LANGUAGE_MORPH = new Set(['merged', 'audio-then-subtitles', 'spinner-with-audio', 'spinner-resolves-with-audio', 'row-leaves']
  .map(name => `components-language-notice--${name}`));
const LANGUAGE_STILL = new Set(['audio-only', 'audio-default', 'refused'].map(name => `components-language-notice--${name}`));
const MORPH_FRAMES = [0, 0.25, 0.5, 0.75, 1] as const;

const REDUCED = new Set(['components-hud--bass', 'components-title-hud--overflow', 'components-caption-notice--loading-to-result', 'components-auto-theater-notice--counting',
  'components-language-notice--spinner-resolves-with-audio']);
export const NARROW_ANCHORS = ['components-control-button-tooltip--above', 'components-hud--text-only', 'components-caption-notice--status', 'components-title-hud--overflow'];

/** Real timer states plus animation fractions; persistent titles/loading use only frame sweeps. */
function momentsFor(id: string): readonly Moment[] | undefined {
  if (id.startsWith('components-hud--seek')) return [
    { timeline: 'enter', frame: 0.15 }, { timeline: 'hold', frame: 0.5 }, { timeline: 'leave', frame: 0.9 }
  ];
  if (id === 'components-auto-theater-notice--ring-exit') return [
    { timeline: 'enter', frame: 0 }, { timeline: 'hold', frame: 0.25 }, { timeline: 'leave', frame: 0.5 }
  ];
  if (id.startsWith('components-hud--') || id.startsWith('components-auto-theater-notice--')
    || id === 'components-caption-notice--status' || id === 'components-caption-notice--loading-to-result'
    || LANGUAGE_STILL.has(id)) return [
    { timeline: 'enter', frame: 0.5 }, { timeline: 'hold', frame: 1 }, { timeline: 'leave', frame: 0.5 }
  ];
  return undefined;
}

export const PLAYER_STORY = 'extension-player-ui--composed';
export const PLAYER_SHOT_SCENARIOS = ['watching', 'settings', 'captions'] as const;

/**
 * Three scenarios on two backdrops. Reduce motion is on: the title marquee and menu transitions
 * are real time, and a capture of them would differ from run to run.
 */
function playerProfiles(): Profile[] {
  const menus = PLAYER_SHOT_SCENARIOS.flatMap(scenario => BACKDROPS.map(backdrop => {
    const profile = environment('en', backdrop);
    return { ...profile, name: `${scenario}-${backdrop}`, globals: { ...profile.globals, reduceMotion: 'on' as const }, args: { scenario } };
  }));
  // The shortcuts help: wide (two columns) in left-to-right, right-to-left and a long locale, and a narrow window (one column).
  const help = ([['en', 1280], ['ar', 1280], ['de', 1280], ['pl', 1280], ['de', 420]] as const).map(([locale, width]): Profile => {
    const profile = environment(locale);
    return {
      ...profile, name: `help-${locale}-${width}`, globals: { ...profile.globals, reduceMotion: 'on' },
      args: { scenario: 'help' }, viewport: { width, height: width === 420 ? 800 : 900 }
    };
  });
  return [...menus, ...help];
}

export function profilesFor(id: string, engine: 'chromium' | 'firefox' = 'chromium'): Profile[] {
  if (id === PLAYER_STORY) return playerProfiles();
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
  for (const profile of profiles) {
    if (profile.frames) continue;
    // A marquee's 0% and 100% are the same seamless-loop image. Short titles are static
    // in Chromium; Firefox's existing short-title marquee still needs its second position.
    if (id === 'components-title-hud--short' || id === 'components-title-hud--with-subtitle') {
      profile.frames = engine === 'firefox' ? [0, 0.5] : [1];
    } else if (id === 'components-title-hud--overflow' || id === 'components-caption-notice--loading') {
      profile.frames = [0, 0.5];
    } else if (id === 'components-auto-theater-notice--no-ring' || id === 'components-hud--loading-plate') profile.frames = [1];
    else if (LANGUAGE_MORPH.has(id)) profile.frames = MORPH_FRAMES;
    else {
      const moments = momentsFor(id);
      // Playback and text without an icon have no distinct entry animation. Keep the held
      // image and the real fade; long status profiles with an icon retain their entry frame.
      profile.moments = id === 'components-hud--playback' || id === 'components-hud--pause' || (id === 'components-hud--text-only' && !profile.args.preset)
        ? moments?.filter(moment => moment.timeline !== 'enter') : moments;
    }
  }
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
    __storyState?: { globals: Record<string, unknown>; args: Record<string, unknown>; timelineSupported: boolean };
  }
}

