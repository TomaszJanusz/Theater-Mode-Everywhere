/** Release generations and visibility rules; deliberately independent of browser APIs. */
export type Generation = `${number}.${number}`;
export const SEEN_ITEMS_STORAGE_KEY = 'newFeaturesSeenItems';
export const SEEN_THROUGH_STORAGE_KEY = 'newFeaturesSeenThrough';
export const HIGHLIGHTS_WINDOW_STORAGE_KEY = 'newFeaturesWindow';
export const FEATURE_HIGHLIGHTS_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** One generation: badges stay hidden while the running generation is not newer than it. */
export const HIDDEN_THROUGH_STORAGE_KEY = 'newFeaturesHiddenThrough';
export const FEATURE_HIGHLIGHTS_LOCAL_KEYS = [SEEN_THROUGH_STORAGE_KEY, SEEN_ITEMS_STORAGE_KEY, HIGHLIGHTS_WINDOW_STORAGE_KEY, HIDDEN_THROUGH_STORAGE_KEY];
type GenerationWindow = { generation: Generation; firstShownAt: number };
export type HighlightsWindow = GenerationWindow & { previous?: GenerationWindow };

function resolveGenerationWindow(value: unknown): GenerationWindow | undefined {
  if (!value || typeof value !== 'object') return;
  const { generation, firstShownAt } = value as Record<string, unknown>;
  if (isGeneration(generation) && typeof firstShownAt === 'number'
    && Number.isSafeInteger(firstShownAt) && firstShownAt >= 0) return { generation, firstShownAt };
  return undefined;
}

export function resolveHighlightsWindow(value: unknown): HighlightsWindow | undefined {
  const current = resolveGenerationWindow(value);
  if (!current) return;
  const previous = resolveGenerationWindow((value as Record<string, unknown>).previous);
  return { ...current, ...(previous?.generation === previousGeneration(current.generation) && previous.firstShownAt <= current.firstShownAt
    ? { previous } : {}) };
}
export const HIGHLIGHT_NEW_FEATURES_STORAGE_KEY = 'highlightNewFeatures';

// One id has one UI home. Tab/toolbar indicators aggregate their visible children.
export const NEW_FEATURE_ITEMS = [
  { id: 'settingsLanguage', since: '2.0' },
  { id: 'settingsPictureLayout', since: '2.0' },
  { id: 'settingsAlwaysShowControls', since: '2.0' },
  { id: 'settingsAutoEnterTheater', since: '2.0' },
  // Optional, default-off features remain discoverable in Settings.
  { id: 'settingsVideoActivator', since: '2.0' },
  { id: 'settingsHighContrast', since: '2.0' },
  { id: 'settingsReduceTransparency', since: '2.0' },
  { id: 'settingsReduceMotion', since: '2.0' },
  // Service tiles are named `rte` + the provider id with a capital first letter.
  { id: 'rteBilibili', since: '2.0' },
  { id: 'rteBilibiliIntl', since: '2.0' },
  { id: 'rteTencent', since: '2.0' },
  { id: 'rteCrunchyroll', since: '2.0' },
  { id: 'rteNetflix', since: '2.0' },
  { id: 'playerPictureLayout', since: '2.0' },
  { id: 'playerAlwaysShowControls', since: '2.0' },
  { id: 'playerAudio', since: '2.0' }
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

export function resolveHiddenThrough(value: unknown): Generation | undefined {
  return isGeneration(value) ? value : undefined;
}

export function resolveSeenThrough(value: unknown, installed: Generation): Generation {
  return isGeneration(value) ? value : previousGeneration(installed);
}

export type FeatureHighlights = {
  installed: Generation; seenThrough: Generation; enabled: boolean;
  window?: HighlightsWindow; now: number; hiddenThrough?: Generation;
  development?: { released: Generation; seenItems: readonly string[] };
};

function itemKey(item: { id: string; since: Generation }): string {
  return `${item.id}@${item.since}`;
}

/** Keep only current catalog identities, including when writing an acknowledgement after an update. */
export function resolveSeenItems(value: unknown): string[] {
  const items = new Set(Array.isArray(value) ? value : []);
  return NEW_FEATURE_ITEMS.map(itemKey).filter(key => items.has(key));
}

/** Apply only supplied keys, so live changes cannot discard the other acknowledgement. */
export function withFeatureHighlightsLocal(state: FeatureHighlights, local: Record<string, unknown>, now: number): FeatureHighlights {
  const value = local[SEEN_ITEMS_STORAGE_KEY];
  return { ...state, now,
    window: HIGHLIGHTS_WINDOW_STORAGE_KEY in local
      ? resolveHighlightsWindow(local[HIGHLIGHTS_WINDOW_STORAGE_KEY]) : state.window,
    hiddenThrough: HIDDEN_THROUGH_STORAGE_KEY in local
      ? resolveHiddenThrough(local[HIDDEN_THROUGH_STORAGE_KEY]) : state.hiddenThrough,
    seenThrough: SEEN_THROUGH_STORAGE_KEY in local
      ? resolveSeenThrough(local[SEEN_THROUGH_STORAGE_KEY], state.installed) : state.seenThrough,
    ...(state.development && SEEN_ITEMS_STORAGE_KEY in local ? {
      development: { ...state.development,
        seenItems: resolveSeenItems(value) }
    } : {})
  };
}
export function resolveFeatureHighlights(
  version: string,
  sync: Record<string, unknown> = {},
  local: Record<string, unknown> = {},
  now = 0
): FeatureHighlights {
  const installed = runningGeneration(version);
  return withFeatureHighlightsLocal({
    installed, now,
    ...(compareGenerations(installedGeneration(version), installed) < 0
      ? { development: { released: installedGeneration(version), seenItems: [] } } : {}),
    seenThrough: resolveSeenThrough(local[SEEN_THROUGH_STORAGE_KEY], installed),
    enabled: resolveHighlightNewFeatures(sync[HIGHLIGHT_NEW_FEATURES_STORAGE_KEY])
  }, local, now);
}

/** Before the acknowledged generation is read nothing counts as new, so a badge never flashes and vanishes. */
export function pendingFeatureHighlights(version: string): FeatureHighlights {
  const installed = runningGeneration(version);
  const state = resolveFeatureHighlights(version);
  return { ...state, installed, seenThrough: installed,
    ...(state.development ? { development: { ...state.development, seenItems: NEW_FEATURE_ITEMS.map(itemKey) } } : {}) };
}

function withinHighlightWindow(since: Generation, state: FeatureHighlights): boolean {
  const window = state.window;
  if (!window || window.generation !== state.installed) return true;
  const firstShownAt = window.previous?.generation === since ? window.previous.firstShownAt : window.firstShownAt;
  return state.now - firstShownAt < FEATURE_HIGHLIGHTS_MAX_AGE_MS;
}

/** "Hide until next version": a newer running generation un-hides without any cleanup write. */
export function badgesHiddenUntilNextVersion(state: FeatureHighlights): boolean {
  return state.hiddenThrough !== undefined && compareGenerations(state.hiddenThrough, state.installed) >= 0;
}

function eligibleSince(since: Generation, state: FeatureHighlights): boolean {
  return state.enabled && !badgesHiddenUntilNextVersion(state) && withinHighlightWindow(since, state)
    && compareGenerations(since, previousGeneration(state.installed)) >= 0
    && compareGenerations(since, state.installed) <= 0;
}

export function isNewSince(since: Generation, state: FeatureHighlights): boolean {
  return eligibleSince(since, state) && compareGenerations(since, state.seenThrough) > 0;
}

export function isNewFeature(id: NewFeatureId, state: FeatureHighlights): boolean {
  const item = NEW_FEATURE_ITEMS.find(item => item.id === id)!;
  if (state.development && compareGenerations(item.since, state.development.released) > 0) {
    return eligibleSince(item.since, state) && !state.development.seenItems.includes(itemKey(item));
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
 * Opening Update highlights (also the automatic Settings prompt) acknowledges the catalog;
 * toggling badge visibility, hiding them until the next version, merely viewing Settings or using player controls does not.
 * Development rebuilds share the running generation’s 30-day profile window; new items do not restart it.
 */
export function featureHighlightsAcknowledgement(state: FeatureHighlights): Record<string, unknown> {
  return {
    [SEEN_THROUGH_STORAGE_KEY]: acknowledgeGeneration(state),
    ...(state.development ? { [SEEN_ITEMS_STORAGE_KEY]: resolveSeenItems([...state.development.seenItems, ...NEW_FEATURE_ITEMS.map(itemKey)]) } : {})
  };
}
