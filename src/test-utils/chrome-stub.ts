import type { Page } from 'playwright';

// The part of `chrome` the player touches: storage.{sync,local}.{get,set},
// storage.onChanged.{add,remove}Listener and an empty runtime (grep `chrome\.` in src/).
// Anything else a test needs (runtime messages, tabs) it adds to `window.chrome` itself.

export type StorageArea = 'sync' | 'local';
export type StorageSeed = Partial<Record<StorageArea, Record<string, unknown>>>;
export type StorageChanges = Record<string, chrome.storage.StorageChange>;

// A string, not a function: serialized functions would carry the test runner's `__name`
// helper, which the page lacks. `get` returns the whole area whatever keys are asked,
// through the callback and the promise; `set` notifies onChanged like the browser does.
const STUB = `(seed => {
  const listeners = new Set();
  const emit = (changes, area) => { for (const listener of [...listeners]) listener(changes, area); };
  const storage = { onChanged: { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn) } };
  for (const [area, initial] of Object.entries(seed)) {
    const data = { ...initial };
    storage[area] = {
      get: (_keys, callback) => { const copy = { ...data }; callback?.(copy); return Promise.resolve(copy); },
      set: (update, callback) => {
        const changes = {};
        for (const [key, newValue] of Object.entries(update)) {
          changes[key] = key in data ? { oldValue: data[key], newValue } : { newValue };
          data[key] = newValue;
        }
        queueMicrotask(() => emit(changes, area));
        callback?.();
        return Promise.resolve();
      }
    };
  }
  window.chrome = { runtime: {}, storage };
  window.__chromeStub = { emit };
})`;

/** Installs the stub with the given areas seeded; unseeded areas are absent. */
export async function installChromeStub(page: Page, seed: StorageSeed): Promise<void> {
  await page.evaluate(`${STUB}(${JSON.stringify(seed)})`);
}

/** Notifies `onChanged` listeners as another extension surface saving would. */
export async function emitStorageChange(page: Page, changes: StorageChanges, area: StorageArea = 'sync'): Promise<void> {
  await page.evaluate(
    ([next, where]) => (window as unknown as { __chromeStub: { emit(c: object, a: string): void } }).__chromeStub.emit(next, where),
    [changes, area] as const
  );
}
