/** Release generations and visibility rules; deliberately independent of browser APIs. */
export type Generation = `${number}.${number}`;
export const SEEN_ITEMS_STORAGE_KEY = 'newFeaturesSeenItems';
export const SEEN_THROUGH_STORAGE_KEY = 'newFeaturesSeenThrough';
export const FEATURE_HIGHLIGHTS_LOCAL_KEYS = [SEEN_THROUGH_STORAGE_KEY, SEEN_ITEMS_STORAGE_KEY];
export const HIGHLIGHT_NEW_FEATURES_STORAGE_KEY = 'highlightNewFeatures';

// One id has one UI home. Tab/toolbar indicators aggregate their visible children.
export const NEW_FEATURE_ITEMS = [
  { id: 'settingsLanguage', since: '1.6' },
  { id: 'settingsPictureLayout', since: '1.6' },
  { id: 'settingsAlwaysShowControls', since: '1.6' },
  { id: 'settingsAutoEnterTheater', since: '1.6' },
  { id: 'settingsHighContrast', since: '1.6' },
  { id: 'settingsReduceTransparency', since: '1.6' },
  { id: 'settingsReduceMotion', since: '1.6' },
  // Service tiles are named `rte` + the provider id with a capital first letter.
  { id: 'rteBilibili', since: '1.6' },
  { id: 'rteBilibiliIntl', since: '1.6' },
  { id: 'rteTencent', since: '1.6' },
  { id: 'rteCrunchyroll', since: '1.6' },
  { id: 'rteNetflix', since: '1.6' },
  { id: 'playerPictureLayout', since: '1.6' },
  { id: 'playerAlwaysShowControls', since: '1.6' },
  { id: 'playerAudio', since: '1.6' }
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

/**
 * Generation the running code behaves as. A development build carries a date-based or previous
 * manifest version while already containing the next generation's items, so it counts as that
 * generation; otherwise its New badges could never show (or be acknowledged) locally.
 */
export function runningGeneration(version: string): Generation {
  const manifest = installedGeneration(version);
  return NEW_FEATURE_ITEMS.reduce<Generation>(
    (latest, item) => compareGenerations(item.since, latest) > 0 ? item.since : latest, manifest);
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

export type FeatureHighlights = {
  installed: Generation; seenThrough: Generation; enabled: boolean;
  development?: { released: Generation; seenItems: readonly string[] };
};

function itemKey(item: { id: string; since: Generation }): string {
  return `${item.id}@${item.since}`;
}

/** Apply only supplied keys, so live changes cannot discard the other acknowledgement. */
export function withFeatureHighlightsLocal(state: FeatureHighlights, local: Record<string, unknown>): FeatureHighlights {
  const value = local[SEEN_ITEMS_STORAGE_KEY];
  return { ...state,
    seenThrough: SEEN_THROUGH_STORAGE_KEY in local
      ? resolveSeenThrough(local[SEEN_THROUGH_STORAGE_KEY], state.installed) : state.seenThrough,
    ...(state.development && SEEN_ITEMS_STORAGE_KEY in local ? {
      development: { ...state.development,
        seenItems: Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [] }
    } : {})
  };
}
export function resolveFeatureHighlights(
  version: string,
  sync: Record<string, unknown> = {},
  local: Record<string, unknown> = {}
): FeatureHighlights {
  const installed = runningGeneration(version);
  return withFeatureHighlightsLocal({
    installed,
    ...(compareGenerations(installedGeneration(version), installed) < 0
      ? { development: { released: installedGeneration(version), seenItems: [] } } : {}),
    seenThrough: resolveSeenThrough(local[SEEN_THROUGH_STORAGE_KEY], installed),
    enabled: resolveHighlightNewFeatures(sync[HIGHLIGHT_NEW_FEATURES_STORAGE_KEY])
  }, local);
}

/** Before the acknowledged generation is read nothing counts as new, so a badge never flashes and vanishes. */
export function pendingFeatureHighlights(version: string): FeatureHighlights {
  const installed = runningGeneration(version);
  const state = resolveFeatureHighlights(version);
  return { ...state, installed, seenThrough: installed,
    ...(state.development ? { development: { ...state.development, seenItems: NEW_FEATURE_ITEMS.map(itemKey) } } : {}) };
}

export function isNewSince(since: Generation, state: FeatureHighlights): boolean {
  return state.enabled && compareGenerations(since, state.seenThrough) > 0
    && compareGenerations(since, previousGeneration(state.installed)) >= 0
    && compareGenerations(since, state.installed) <= 0;
}

export function isNewFeature(id: NewFeatureId, state: FeatureHighlights): boolean {
  const item = NEW_FEATURE_ITEMS.find(item => item.id === id)!;
  if (state.development && compareGenerations(item.since, state.development.released) > 0) {
    return state.enabled && !state.development.seenItems.includes(itemKey(item));
  }
  return isNewSince(item.since, state);
}

/** Install initializes; updates intentionally leave the acknowledgement untouched. */
export function initialSeenThrough(reason: string, version: string): Record<string, Generation> {
  return reason === 'install' ? { [SEEN_THROUGH_STORAGE_KEY]: installedGeneration(version) } : {};
}

export function acknowledgeGeneration(state: FeatureHighlights): Generation {
  const installed = state.development?.released ?? state.installed;
  return compareGenerations(state.seenThrough, installed) > 0 ? state.seenThrough : installed;
}

/**
 * Releases acknowledge a generation. Builds containing unreleased items acknowledge the exact
 * id/since pairs present in that profile, independently of the manifest's date-based version.
 * Reloading or rebuilding identical items stays acknowledged; adding an item (even in the same
 * generation) shows it again. Legacy generation-only acknowledgements cannot hide unreleased items.
 * Opening Update highlights (also the automatic Settings prompt) or disabling highlights acknowledges
 * the catalog; merely viewing Settings or using player controls does not.
 */
export function featureHighlightsAcknowledgement(state: FeatureHighlights): Record<string, unknown> {
  return {
    [SEEN_THROUGH_STORAGE_KEY]: acknowledgeGeneration(state),
    ...(state.development ? { [SEEN_ITEMS_STORAGE_KEY]: [...new Set([
      ...state.development.seenItems, ...NEW_FEATURE_ITEMS.map(itemKey)
    ])] } : {})
  };
}
