import { isMessageCatalog, type MessageCatalog } from '../src/message-catalog';

// Stories stub only the extension edge: `chrome.storage` and the language-catalog message the
// background answers. Everything past that edge is the production code.
type StorageListener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => void;

const catalogs = import.meta.glob<MessageCatalog>('../_locales/*/messages.json', { import: 'default' });

const storage: Record<string, unknown> = {};
const listeners = new Set<StorageListener>();

/** Writes `chrome.storage.sync` the way the options page does, notifying production listeners. */
export function setSyncStorage(patch: Record<string, unknown>): void {
  const changes: Record<string, chrome.storage.StorageChange> = {};
  for (const [key, newValue] of Object.entries(patch)) {
    if (storage[key] === newValue) continue;
    changes[key] = { oldValue: storage[key], newValue };
    storage[key] = newValue;
  }
  if (Object.keys(changes).length === 0) return;
  for (const listener of [...listeners]) listener(changes, 'sync');
}

async function languageCatalog(locale: string): Promise<MessageCatalog> {
  const load = catalogs[`../_locales/${locale}/messages.json`];
  const catalog: unknown = load ? await load() : undefined;
  if (!isMessageCatalog(catalog)) throw new Error(`No catalog for ${locale}`);
  return catalog;
}

export function installChromeStub(): void {
  globalThis.chrome = {
    runtime: {
      lastError: undefined,
      sendMessage: async (message: { action?: string; locale?: string }) => {
        if (message.action === 'get-language-catalog' && message.locale) return languageCatalog(message.locale);
        return undefined;
      }
    },
    storage: {
      sync: {
        get: (keys: string[], callback: (items: Record<string, unknown>) => void) => {
          callback(Object.fromEntries(keys.filter(key => key in storage).map(key => [key, storage[key]])));
        }
      },
      onChanged: {
        addListener: (listener: StorageListener) => { listeners.add(listener); },
        removeListener: (listener: StorageListener) => { listeners.delete(listener); }
      }
    }
  } as unknown as typeof chrome;
}
