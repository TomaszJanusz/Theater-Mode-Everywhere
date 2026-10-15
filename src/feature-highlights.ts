/** Release generations and visibility rules; deliberately independent of browser APIs. */
export type Generation = `${number}.${number}`;
export const SEEN_THROUGH_STORAGE_KEY = 'newFeaturesSeenThrough';
export const HIGHLIGHT_NEW_FEATURES_STORAGE_KEY = 'highlightNewFeatures';

// One id has one UI home. Tab/toolbar indicators aggregate their visible children.
export const NEW_FEATURE_ITEMS = [
  { id: 'settingsLanguage', since: '1.6' },
  { id: 'settingsPictureLayout', since: '1.6' },
  { id: 'settingsAlwaysShowControls', since: '1.6' },
  { id: 'playerPictureLayout', since: '1.6' },
  { id: 'playerAlwaysShowControls', since: '1.6' },
  { id: 'playerVoiceBoost', since: '1.6' },
  { id: 'playerReduceLoudSounds', since: '1.6' },
  { id: 'playerBass', since: '1.6' }
] as const satisfies readonly { id: string; since: Generation }[];
export type NewFeatureId = typeof NEW_FEATURE_ITEMS[number]['id'];

function isGeneration(value: unknown): value is Generation {
  return typeof value === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)
    && value.split('.').every(part => Number.isSafeInteger(Number(part)));
}

export function installedGeneration(version: string): Generation {
  const generation = version.split('.').slice(0, 2).join('.');
  if (!isGeneration(generation)) throw new Error(`Invalid installed version: ${version}`);
  return generation;
}

export function compareGenerations(left: Generation, right: Generation): number {
  const [major, minor] = left.split('.').map(Number);
  const [otherMajor, otherMinor] = right.split('.').map(Number);
  return major - otherMajor || minor - otherMinor;
}

export function previousGeneration(installed: Generation): Generation {
  const [major, minor] = installed.split('.').map(Number);
  if (minor > 0) return `${major}.${minor - 1}`;
  // At a major rollover, release-owned history supplies the preceding minor.
  const known: Generation[] = ['1.5', ...NEW_FEATURE_ITEMS.map(item => item.since)];
  return known.filter(value => compareGenerations(value, installed) < 0)
    .sort(compareGenerations).at(-1) ?? `${Math.max(0, major - 1)}.0`;
}

export function resolveHighlightNewFeatures(value: unknown): boolean {
  return typeof value === 'boolean' ? value : true;
}

export function resolveSeenThrough(value: unknown, installed: Generation): Generation {
  return isGeneration(value) ? value : previousGeneration(installed);
}

export type FeatureHighlights = { installed: Generation; seenThrough: Generation; enabled: boolean };
export function resolveFeatureHighlights(
  version: string,
  sync: Record<string, unknown> = {},
  local: Record<string, unknown> = {}
): FeatureHighlights {
  const installed = installedGeneration(version);
  return {
    installed,
    seenThrough: resolveSeenThrough(local[SEEN_THROUGH_STORAGE_KEY], installed),
    enabled: resolveHighlightNewFeatures(sync[HIGHLIGHT_NEW_FEATURES_STORAGE_KEY])
  };
}

export function isNewSince(since: Generation, state: FeatureHighlights): boolean {
  return state.enabled && compareGenerations(since, state.seenThrough) > 0
    && compareGenerations(since, previousGeneration(state.installed)) >= 0
    && compareGenerations(since, state.installed) <= 0;
}

export function isNewFeature(id: NewFeatureId, state: FeatureHighlights): boolean {
  return isNewSince(NEW_FEATURE_ITEMS.find(item => item.id === id)!.since, state);
}

/** Install initializes; updates intentionally leave the acknowledgement untouched. */
export function initialSeenThrough(reason: string, version: string): Record<string, Generation> {
  return reason === 'install' ? { [SEEN_THROUGH_STORAGE_KEY]: installedGeneration(version) } : {};
}

export function acknowledgeGeneration(state: FeatureHighlights): Generation {
  return compareGenerations(state.seenThrough, state.installed) > 0 ? state.seenThrough : state.installed;
}
