import {
  FEATURE_HIGHLIGHTS_LOCAL_KEYS, HIDDEN_THROUGH_STORAGE_KEY, HIGHLIGHTS_WINDOW_STORAGE_KEY, SEEN_ITEMS_STORAGE_KEY,
  featureHighlightsAcknowledgement, initialSeenThrough, resolveFeatureHighlights,
  resolveHiddenThrough, resolveHighlightsWindow, resolveSeenItems, runningGeneration, previousGeneration, compareGenerations
} from './feature-highlights';
import {
  LEGACY_WHATS_NEW_AUTO_OPEN_PREFIX, WHATS_NEW_AUTO_OPEN_MIGRATION_KEY,
  WHATS_NEW_ACK_STORAGE_KEY, WHATS_NEW_AUTO_OPEN_STORAGE_KEY, WHATS_NEW_RELEASE,
  legacyWhatsNewAutoOpenStorageKey, resolveWhatsNewAutoOpened, shouldAutoOpenWhatsNewOnUpdate,
  type WhatsNewInstallDetails
} from './whatsNew-release';

type LocalStorage = {
  get(keys: string | string[] | null): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
};

/** Background is the sole writer: serialize read/modify/write across all extension contexts. */
export function createFeatureHighlightsLifecycle(local: LocalStorage, version: string, now: () => number) {
  let tail = Promise.resolve();
  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = tail.then(operation);
    tail = result.then(() => {}, () => {});
    return result;
  }

  async function read() {
    const data = await local.get(FEATURE_HIGHLIGHTS_LOCAL_KEYS);
    const window = resolveHighlightsWindow(data[HIGHLIGHTS_WINDOW_STORAGE_KEY]);
    const generation = runningGeneration(version);
    // One window per running generation, including development rebuilds. Patch builds never reset it.
    // Reject future timestamps from corrupt storage instead of extending badge lifetime indefinitely.
    const time = now();
    const writes: Record<string, unknown> = {};
    if (!window || window.generation !== generation || window.firstShownAt > time) {
      // Carry only the preceding eligible generation. Replacing its clock would resurrect
      // expired badges on a minor/major upgrade; no per-item or unbounded history is needed.
      const previous = window?.generation === previousGeneration(generation) && window.firstShownAt <= time
        ? { generation: window.generation, firstShownAt: window.firstShownAt } : undefined;
      writes[HIGHLIGHTS_WINDOW_STORAGE_KEY] = { generation, firstShownAt: time, ...(previous ? { previous } : {}) };
    }
    const seen = resolveSeenItems(data[SEEN_ITEMS_STORAGE_KEY]);
    if (JSON.stringify(data[SEEN_ITEMS_STORAGE_KEY]) !== JSON.stringify(seen)) writes[SEEN_ITEMS_STORAGE_KEY] = seen;
    // Bounded to one generation; a marker from an older generation has expired, so drop it.
    const hidden = resolveHiddenThrough(data[HIDDEN_THROUGH_STORAGE_KEY]);
    const stale = data[HIDDEN_THROUGH_STORAGE_KEY] !== undefined
      && (!hidden || compareGenerations(hidden, generation) < 0);
    if (Object.keys(writes).length) await local.set(writes);
    if (stale) await local.remove([HIDDEN_THROUGH_STORAGE_KEY]);
    const result: Record<string, unknown> = { ...data, ...writes };
    if (stale) delete result[HIDDEN_THROUGH_STORAGE_KEY];
    return result;
  }

  async function migrateAutoOpen() {
    const marker = await local.get(WHATS_NEW_AUTO_OPEN_MIGRATION_KEY);
    if (marker[WHATS_NEW_AUTO_OPEN_MIGRATION_KEY] === true) return;
    // The only full enumeration. Seed before removing legacy markers; mark complete last so a
    // failed/interrupted migration can repeat without re-prompting or deleting unrelated keys.
    const data = await local.get(null);
    if (data[legacyWhatsNewAutoOpenStorageKey(version)] === true) {
      await local.set({ [WHATS_NEW_AUTO_OPEN_STORAGE_KEY]: { releaseId: WHATS_NEW_RELEASE.id, version } });
    }
    const keys = Object.keys(data).filter(key => key.startsWith(LEGACY_WHATS_NEW_AUTO_OPEN_PREFIX));
    if (keys.length) await local.remove(keys);
    await local.set({ [WHATS_NEW_AUTO_OPEN_MIGRATION_KEY]: true });
  }

  return {
    read: () => enqueue(read),
    acknowledge: () => enqueue(async () => {
      const data = await read();
      await local.set({
        ...featureHighlightsAcknowledgement(resolveFeatureHighlights(version, {}, data, now())),
        [WHATS_NEW_ACK_STORAGE_KEY]: WHATS_NEW_RELEASE.id
      });
    }),
    hideUntilNextVersion: () => enqueue(async () => {
      await read();
      await local.set({ [HIDDEN_THROUGH_STORAGE_KEY]: runningGeneration(version) });
    }),
    restoreHidden: () => enqueue(async () => { await local.remove([HIDDEN_THROUGH_STORAGE_KEY]); }),
    installed: (details: WhatsNewInstallDetails, openOptions: () => Promise<void>) => enqueue(async () => {
      await migrateAutoOpen();
      await read();
      const initial = initialSeenThrough(details.reason, version);
      if (Object.keys(initial).length) await local.set(initial);
      const data = await local.get([WHATS_NEW_ACK_STORAGE_KEY, WHATS_NEW_AUTO_OPEN_STORAGE_KEY]);
      const ack = data[WHATS_NEW_ACK_STORAGE_KEY];
      const opened = resolveWhatsNewAutoOpened(data[WHATS_NEW_AUTO_OPEN_STORAGE_KEY]);
      if (!shouldAutoOpenWhatsNewOnUpdate(details, typeof ack === 'string' ? ack : undefined)
        || (opened?.releaseId === WHATS_NEW_RELEASE.id && opened.version === version)) return;
      // A bounded last pair cannot retain arbitrary downgrade/re-upgrade history.
      await local.set({ [WHATS_NEW_AUTO_OPEN_STORAGE_KEY]: { releaseId: WHATS_NEW_RELEASE.id, version } });
      await openOptions();
    })
  };
}
