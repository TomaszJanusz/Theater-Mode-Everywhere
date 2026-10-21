import { isMessageCatalog, type MessageCatalog } from '../src/message-catalog';

// Stories stub only the extension edge: `chrome.storage` and the language-catalog message the
// background answers. Everything past that edge is the production code.
type StorageListener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => void;
type Area = 'sync' | 'local';
type Items = Record<string, unknown>;
type Request = { action?: string; locale?: string };

const catalogs = import.meta.glob<MessageCatalog>('../_locales/*/messages.json', { import: 'default' });

async function languageCatalog(locale: string): Promise<MessageCatalog> {
  const load = catalogs[`../_locales/${locale}/messages.json`];
  const catalog: unknown = load ? await load() : undefined;
  if (!isMessageCatalog(catalog)) throw new Error(`No catalog for ${locale}`);
  return catalog;
}

export interface ChromeStub {
  chrome: typeof chrome;
  /** Writes `chrome.storage.sync` the way the options page does, notifying production listeners. */
  setSyncStorage(patch: Items): void;
  /** Messages that reached the extension edge and have no handler here, e.g. `open-options-page`. */
  readonly unhandled: readonly Request[];
  readonly listenerCount: number;
  dispose(): void;
}

function selected(data: Items, keys: unknown): Items {
  if (keys == null) return { ...data };
  if (typeof keys === 'string') return keys in data ? { [keys]: data[keys] } : {};
  if (Array.isArray(keys)) return Object.fromEntries(keys.filter(key => key in data).map(key => [key, data[key]]));
  return Object.fromEntries(Object.entries(keys as Items).map(([key, fallback]) => [key, key in data ? data[key] : fallback]));
}

/**
 * The part of `chrome` the player touches, for one document. Storage answers through the
 * callback and the Promise form (the runtime uses both) and `set` notifies `onChanged`
 * after its Promise settles, as the browser does.
 */
export function createChromeStub(seed: Partial<Record<Area, Items>> = {}): ChromeStub {
  const data: Record<Area, Items> = { sync: { ...seed.sync }, local: { ...seed.local } };
  const listeners = new Set<StorageListener>();
  const unhandled: Request[] = [];
  const notify = (area: Area, patch: Items) => {
    const changes: Record<string, chrome.storage.StorageChange> = {};
    for (const [key, newValue] of Object.entries(patch)) {
      if (data[area][key] === newValue) continue;
      changes[key] = { oldValue: data[area][key], newValue };
      data[area][key] = newValue;
    }
    if (Object.keys(changes).length === 0) return;
    for (const listener of [...listeners]) listener(changes, area);
  };
  const areaApi = (area: Area) => ({
    get: (keys?: unknown, callback?: (items: Items) => void) => {
      const items = selected(data[area], keys);
      callback?.(items);
      return Promise.resolve(items);
    },
    set: (patch: Items, callback?: () => void) => {
      notify(area, patch);
      callback?.();
      return Promise.resolve();
    }
  });
  const stub = {
    runtime: {
      lastError: undefined,
      getURL: (path: string) => path,
      sendMessage: async (request: Request) => {
        if (request.action === 'get-language-catalog' && request.locale) return languageCatalog(request.locale);
        unhandled.push(request);
        return undefined;
      }
    },
    storage: {
      sync: areaApi('sync'),
      local: areaApi('local'),
      onChanged: {
        addListener: (listener: StorageListener) => { listeners.add(listener); },
        removeListener: (listener: StorageListener) => { listeners.delete(listener); }
      }
    }
  };
  return {
    chrome: stub as unknown as typeof chrome,
    setSyncStorage: patch => notify('sync', patch),
    unhandled,
    get listenerCount() { return listeners.size; },
    dispose: () => { listeners.clear(); }
  };
}

let installed: ChromeStub | undefined;

export function installChromeStub(): void {
  installed = createChromeStub();
  globalThis.chrome = installed.chrome;
}

export function setSyncStorage(patch: Items): void {
  if (!installed) throw new Error('installChromeStub() has not run');
  installed.setSyncStorage(patch);
}
