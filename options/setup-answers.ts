/** How the setup's answers map to and from the existing settings, through their own resolvers. */
import {
  MEDIA_PROVIDER_IDS, mediaProviderFlagStorageUpdate, mediaProviderFlagsEqual, mediaProviderFlagsForRichTheaterExperience,
  resolveMediaProviderFlags, type MediaProviderFlags
} from '../src/media-features/provider-flags';

export type ServicesChoice = 'all' | 'choose' | 'none';
export interface SetupAnswers {
  services: ServicesChoice;
  /** The per-service switches behind "Choose services"; kept while another choice is selected. */
  chosen: MediaProviderFlags;
}

/** The answers that describe `stored` settings: a fresh profile gets the defaults. */
export function answersFromSettings(stored: Record<string, unknown>): SetupAnswers {
  const chosen = resolveMediaProviderFlags(stored);
  const on = MEDIA_PROVIDER_IDS.filter(id => chosen[id]).length;
  if (on === MEDIA_PROVIDER_IDS.length) return { services: 'all', chosen };
  // "None" keeps the switches on, so moving to "Choose services" starts from everything.
  if (on === 0) return { services: 'none', chosen: mediaProviderFlagsForRichTheaterExperience(true) };
  return { services: 'choose', chosen };
}

/** The answers a reset profile starts from: the setup's preselection. */
export const defaultSetupAnswers = (): SetupAnswers => answersFromSettings({});

export function serviceFlags(answers: SetupAnswers): MediaProviderFlags {
  if (answers.services === 'choose') return answers.chosen;
  return mediaProviderFlagsForRichTheaterExperience(answers.services === 'all');
}

/**
 * The sync writes that turn `stored` into the answers: only settings whose resolved value changes.
 * A service change writes every service flag, because `resolveMediaProviderFlags` reads the first five
 * all off as a legacy "everything off" and would turn the unwritten ones off too.
 */
export function setupSettingsPatch(answers: SetupAnswers, stored: Record<string, unknown>): Record<string, unknown> {
  const flags = serviceFlags(answers);
  return mediaProviderFlagsEqual(flags, resolveMediaProviderFlags(stored)) ? {} : mediaProviderFlagStorageUpdate(flags);
}
