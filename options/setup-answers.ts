/** How the setup's answers map to and from the existing settings, through their own resolvers. */
import {
  AUTO_SKIP_COUNTDOWN_KEY, AUTO_THEATER_STORAGE_KEY, resolveAutoEnterTheater, resolveSkipCountdown
} from '../src/auto-theater-preferences';
import { FRESH_INSTALL_SETTINGS } from '../src/first-run-setup';
import {
  MEDIA_PROVIDER_IDS, mediaProviderFlagStorageUpdate, mediaProviderFlagsEqual, mediaProviderFlagsForRichTheaterExperience,
  resolveMediaProviderFlags, type MediaProviderFlags
} from '../src/media-features/provider-flags';
import { PROVIDER_CAPABILITIES } from '../src/providers/capabilities';
import { serviceAutoEnabled } from '../src/providers/settings-values';
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
    volumeBoost: resolveVolumeBoostEnabled(stored[VOLUME_BOOST_STORAGE_KEY])
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
  const set = (key: string, value: boolean, resolve: (stored: unknown) => boolean) => {
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
  return patch;
}
