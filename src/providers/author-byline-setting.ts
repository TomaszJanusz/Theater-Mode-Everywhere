import { BYLINE_STORAGE_KEY, DEFAULT_AUTHOR_BYLINE, resolveBylineEnabled } from './settings-values';

/** The saved switch, followed live: `enabled` is null until the first read lands, then follows every sync change. */
export interface AuthorBylineSetting {
  readonly enabled: boolean | null;
  /** Settles once `enabled` is known. */
  readonly ready: Promise<void>;
  subscribe(changed: () => void): () => void;
  dispose(): void;
}

/**
 * Reads the switch once and follows its changes. A change seen before the first read lands wins over that read.
 * Without extension storage (a page harness, a script orphaned by an update) the default applies at once, and a
 * failing read falls back to it, so the service's own setting decides.
 */
export function watchAuthorBylineSetting(): AuthorBylineSetting {
  const storage = typeof chrome === 'undefined' ? undefined : chrome.storage;
  let enabled: boolean | null = storage ? null : DEFAULT_AUTHOR_BYLINE;
  let revision = 0;
  let disposed = false;
  const listeners = new Set<() => void>();
  const apply = (value: unknown) => {
    enabled = resolveBylineEnabled(value);
    for (const changed of listeners) changed();
  };
  const onStorage = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (disposed || area !== 'sync' || !(BYLINE_STORAGE_KEY in changes)) return;
    revision++;
    apply(changes[BYLINE_STORAGE_KEY].newValue);
  };
  try { storage?.onChanged.addListener(onStorage); } catch { /* No live updates. */ }
  const ready = storage ? (async () => {
    let stored: unknown;
    try { stored = (await storage.sync.get(BYLINE_STORAGE_KEY))[BYLINE_STORAGE_KEY]; } catch { /* Default. */ }
    if (!disposed && !revision) apply(stored);
  })() : Promise.resolve();
  return {
    ready,
    get enabled() { return enabled; },
    subscribe(changed) { listeners.add(changed); return () => { listeners.delete(changed); }; },
    dispose() {
      if (disposed) return;
      disposed = true;
      listeners.clear();
      try { storage?.onChanged.removeListener(onStorage); } catch { /* Never subscribed. */ }
    }
  };
}
