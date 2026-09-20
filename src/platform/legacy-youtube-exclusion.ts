import { normalizeHost } from './domain-policy';

export const LEGACY_YOUTUBE_EXCLUSION_MIGRATION_KEY = 'migration:remove-legacy-youtube-exclusion:v1';

/** Removes the old bundled YouTube exclusion while preserving all other rules. */
export function removeLegacyYoutubeExclusion(entries: readonly string[]): string[] {
  return entries.filter((entry) => normalizeHost(entry) !== 'youtube.com');
}
