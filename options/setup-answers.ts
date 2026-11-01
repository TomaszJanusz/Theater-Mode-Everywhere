/** How the setup's answers map to and from the existing settings, through their own resolvers. */
import { ACCENT_COLOR_STORAGE_KEY, resolveAccentColorPreset, type AccentColorPreset } from '../src/accentTheme';
import {
  AUTO_SKIP_COUNTDOWN_KEY, AUTO_THEATER_STORAGE_KEY, resolveAutoEnterTheater, resolveSkipCountdown
} from '../src/auto-theater-preferences';
import { FRESH_INSTALL_SETTINGS, INSTALL_SHORTCUTS } from '../src/first-run-setup';
import { LANGUAGE_STORAGE_KEY, resolveLanguage, type Language } from '../src/language';
import {
  MEDIA_PROVIDER_IDS, mediaProviderFlagStorageUpdate, mediaProviderFlagsEqual, mediaProviderFlagsForRichTheaterExperience,
  resolveMediaProviderFlags, type MediaProviderFlags
} from '../src/media-features/provider-flags';
import { PROVIDER_CAPABILITIES } from '../src/providers/capabilities';
import { serviceAutoEnabled } from '../src/providers/settings-values';
import { KEEP_CONTROLS_VISIBLE_STORAGE_KEY, resolveKeepControlsVisible } from '../src/ui/keep-controls-visible-settings';
import {
  PICTURE_ALIGN_STORAGE_KEY, RAISE_ONLY_WITH_SUBTITLES_STORAGE_KEY, resolvePictureAlign, resolveRaiseOnlyWithSubtitles, type PictureAlign
} from '../src/ui/picture-align-settings';
import { resolveSeekHold, SEEK_HOLD_STORAGE_KEY } from '../src/ui/shortcuts';
import {
  resolveVideoActivator, VIDEO_ACTIVATOR_PROMPT_ANSWER_STORAGE_KEY, VIDEO_ACTIVATOR_STORAGE_KEY
} from '../src/ui/video-activator-settings';
import { resolveVolumeBoostEnabled, VOLUME_BOOST_STORAGE_KEY } from '../src/ui/volume-boost-settings';

export type ServicesChoice = 'all' | 'choose' | 'none';
/** How theater mode starts: only the theater key, the key or the video launcher, or AutoTheater. */
export type StartChoice = 'key' | 'button' | 'auto';
export interface SetupAnswers {
  services: ServicesChoice;
  /** The per-service switches behind "Choose services"; kept while another choice is selected. */
  chosen: MediaProviderFlags;
  start: StartChoice;
  /** AutoTheater's "Skip countdown"; kept while another start is selected. */
  skipCountdown: boolean;
  seekHold: boolean;
  volumeBoost: boolean;
  language: Language;
  accent: AccentColorPreset;
  layout: PictureAlign;
  /** "Raised only with subtitles"; kept while Centered is selected. */
  raiseOnlyWithSubtitles: boolean;
  pinControls: boolean;
}

function servicesFrom(stored: Record<string, unknown>): Pick<SetupAnswers, 'services' | 'chosen'> {
  const chosen = resolveMediaProviderFlags(stored);
  const on = MEDIA_PROVIDER_IDS.filter(id => chosen[id]).length;
  if (on === MEDIA_PROVIDER_IDS.length) return { services: 'all', chosen };
  // "None" keeps the switches on, so moving to "Choose services" starts from everything.
  if (on === 0) return { services: 'none', chosen: mediaProviderFlagsForRichTheaterExperience(true) };
  return { services: 'choose', chosen };
}

function startFrom(stored: Record<string, unknown>): StartChoice {
  if (resolveAutoEnterTheater(stored[AUTO_THEATER_STORAGE_KEY])) return 'auto';
  return resolveVideoActivator(stored[VIDEO_ACTIVATOR_STORAGE_KEY]) ? 'button' : 'key';
}

/** The answers that describe `stored` settings. */
export function answersFromSettings(stored: Record<string, unknown>): SetupAnswers {
  return {
    ...servicesFrom(stored),
    start: startFrom(stored),
    skipCountdown: resolveSkipCountdown(stored[AUTO_SKIP_COUNTDOWN_KEY]),
    seekHold: resolveSeekHold(stored[SEEK_HOLD_STORAGE_KEY]),
    volumeBoost: resolveVolumeBoostEnabled(stored[VOLUME_BOOST_STORAGE_KEY]),
    language: resolveLanguage(stored[LANGUAGE_STORAGE_KEY]),
    accent: resolveAccentColorPreset(stored[ACCENT_COLOR_STORAGE_KEY]),
    layout: resolvePictureAlign(stored[PICTURE_ALIGN_STORAGE_KEY]),
    raiseOnlyWithSubtitles: resolveRaiseOnlyWithSubtitles(stored[RAISE_ONLY_WITH_SUBTITLES_STORAGE_KEY]),
    pinControls: resolveKeepControlsVisible(stored[KEEP_CONTROLS_VISIBLE_STORAGE_KEY])
  };
}

/** The setup's preselection: a fresh install's settings. A reset starts from these too. */
export const defaultSetupAnswers = (): SetupAnswers => answersFromSettings({ ...FRESH_INSTALL_SETTINGS });

export function serviceFlags(answers: SetupAnswers): MediaProviderFlags {
  if (answers.services === 'choose') return answers.chosen;
  return mediaProviderFlagsForRichTheaterExperience(answers.services === 'all');
}

/**
 * Whether AutoTheater could start anywhere with these answers: a chosen service supports it and its own
 * AutoTheater switch (Settings → Features, per service) is on. The setup sets only the global preference.
 */
export function autoTheaterAvailable(answers: SetupAnswers, stored: Record<string, unknown>): boolean {
  const flags = serviceFlags(answers);
  return PROVIDER_CAPABILITIES.some(provider => flags[provider.id] && provider.capabilities.autoTheater.status !== 'no'
    && serviceAutoEnabled(stored.providerSettings, provider.id));
}

/** The start that applies: "Start automatically" falls back to the key alone when nothing could start it. */
export function effectiveStart(answers: SetupAnswers, stored: Record<string, unknown>): StartChoice {
  return answers.start === 'auto' && !autoTheaterAvailable(answers, stored) ? 'key' : answers.start;
}

/**
 * The sync writes that turn `stored` into the answers: only settings whose resolved value changes.
 * A service change writes every service flag, because `resolveMediaProviderFlags` reads the first five
 * all off as a legacy "everything off" and would turn the unwritten ones off too.
 */
export function setupSettingsPatch(answers: SetupAnswers, stored: Record<string, unknown>): Record<string, unknown> {
  const flags = serviceFlags(answers);
  const patch: Record<string, unknown> = mediaProviderFlagsEqual(flags, resolveMediaProviderFlags(stored)) ? {} : mediaProviderFlagStorageUpdate(flags);
  const set = <Value>(key: string, value: Value, resolve: (stored: unknown) => Value) => {
    if (resolve(stored[key]) !== value) patch[key] = value;
  };
  const start = effectiveStart(answers, stored);
  set(AUTO_THEATER_STORAGE_KEY, start === 'auto', resolveAutoEnterTheater);
  if (start === 'auto') {
    // The launcher may stay on beside AutoTheater, as Settings allows; the setup only adds the automatic start.
    set(AUTO_SKIP_COUNTDOWN_KEY, answers.skipCountdown, resolveSkipCountdown);
  } else {
    set(VIDEO_ACTIVATOR_STORAGE_KEY, start === 'button', resolveVideoActivator);
    // Answers the "Enable the video launcher?" offer that turning AutoTheater off in Settings would make later.
    if (typeof stored[VIDEO_ACTIVATOR_PROMPT_ANSWER_STORAGE_KEY] !== 'boolean') patch[VIDEO_ACTIVATOR_PROMPT_ANSWER_STORAGE_KEY] = start === 'button';
  }
  set(SEEK_HOLD_STORAGE_KEY, answers.seekHold, resolveSeekHold);
  set(VOLUME_BOOST_STORAGE_KEY, answers.volumeBoost, resolveVolumeBoostEnabled);
  set(LANGUAGE_STORAGE_KEY, answers.language, resolveLanguage);
  set(ACCENT_COLOR_STORAGE_KEY, answers.accent, resolveAccentColorPreset);
  set(PICTURE_ALIGN_STORAGE_KEY, answers.layout, resolvePictureAlign);
  // Settings offers "Raised only with subtitles" under Raised only; so does the setup.
  if (answers.layout === 'top') set(RAISE_ONLY_WITH_SUBTITLES_STORAGE_KEY, answers.raiseOnlyWithSubtitles, resolveRaiseOnlyWithSubtitles);
  set(KEEP_CONTROLS_VISIBLE_STORAGE_KEY, answers.pinControls, resolveKeepControlsVisible);
  return patch;
}

/** Kept by a reset unless the user also asks for them: lists and keys people build up by hand. */
const KEPT_SETTINGS = ['blacklist', 'shortcuts'] as const;

export interface ResetPatch {
  /** Sync keys to remove, so their own resolvers apply the code defaults. */
  remove: string[];
  /** Sync values a fresh install writes that `sync` does not already hold. */
  set: Record<string, unknown>;
}

/**
 * The sync changes that return `sync` to what a fresh install starts with: one remove and one set at most, and
 * only for keys that differ. Excluded websites and shortcuts stay unless `everything`.
 */
export function resetSettingsPatch(sync: Record<string, unknown>, everything: boolean): ResetPatch {
  const fresh: Record<string, unknown> = { ...FRESH_INSTALL_SETTINGS };
  if (everything) Object.assign(fresh, { shortcuts: { ...INSTALL_SHORTCUTS }, blacklist: [] });
  const kept: readonly string[] = everything ? [] : KEPT_SETTINGS;
  const same = (key: string) => JSON.stringify(sync[key]) === JSON.stringify(fresh[key]);
  return {
    remove: Object.keys(sync).filter(key => !kept.includes(key) && !Object.hasOwn(fresh, key)),
    set: Object.fromEntries(Object.entries(fresh).filter(([key]) => !same(key)))
  };
}
