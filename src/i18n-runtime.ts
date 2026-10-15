import { LANGUAGE_STORAGE_KEY, DEFAULT_LANGUAGE, resolveLanguage, type Language, type Locale } from './language';
import { compileCatalog, isMessageCatalog, substituteMessage, type MessageCatalog } from './message-catalog';

type CatalogLoader = (locale: Locale) => Promise<MessageCatalog>;

export function createLanguageRuntime(load: CatalogLoader) {
  let language: Language = DEFAULT_LANGUAGE;
  let requested: Language = DEFAULT_LANGUAGE;
  let revision = 0;
  let loadEpoch = 0;
  let catalog: ReadonlyMap<string, string> | null = null;
  let pending = Promise.resolve();
  const listeners = new Set<() => void>();

  function publish(next: Language, messages: ReadonlyMap<string, string> | null) {
    language = next;
    catalog = messages;
    // Publish the entire snapshot before synchronously rebuilding any UI.
    for (const listener of [...listeners]) listener();
  }

  function set(value: unknown, expectedRevision = revision): Promise<void> {
    if (expectedRevision !== revision) return pending;
    // Even an unchanged storage event supersedes a read started before that event.
    revision += 1;
    const next = resolveLanguage(value);
    if (next === requested) return pending;
    requested = next;
    const epoch = ++loadEpoch;
    if (next === DEFAULT_LANGUAGE) {
      publish(next, null);
      pending = Promise.resolve();
    } else {
      pending = load(next).then(messages => {
        if (epoch === loadEpoch) publish(next, compileCatalog(messages));
      }).catch(error => {
        if (epoch !== loadEpoch) return;
        console.error('[Theater Everywhere] Could not load language:', error);
        requested = DEFAULT_LANGUAGE;
        publish(DEFAULT_LANGUAGE, null);
      });
    }
    return pending;
  }

  return {
    set,
    get revision() { return revision; },
    get language() { return language; },
    get overridden() { return catalog !== null; },
    message(key: string, substitutions?: string | string[]): string | undefined {
      const name = key.toLowerCase();
      if (name === '@@ui_locale') return language;
      if (name === '@@bidi_dir') return language === 'ar' ? 'rtl' : 'ltr';
      const message = catalog?.get(name);
      return message === undefined ? undefined : substituteMessage(message, substitutions);
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    }
  };
}

export const languageRuntime = createLanguageRuntime(async locale => {
  const response: unknown = await chrome.runtime.sendMessage({ action: 'get-language-catalog', locale });
  if (!isMessageCatalog(response)) throw new Error('Invalid language catalog');
  return response;
});

/** Shared by extension pages and player UI; Automatic still calls native i18n directly. */
export function translateMessage(fallbacks: Record<string, string>, key: string, substitutions?: string | string[]): string {
  if (languageRuntime.overridden) return languageRuntime.message(key, substitutions) ?? key;
  try {
    if (typeof chrome !== 'undefined' && chrome.i18n?.getMessage) {
      const message = chrome.i18n.getMessage(key, substitutions);
      if (message) return message;
    }
  } catch {
    // Local/test documents have no extension i18n context.
  }
  return Object.hasOwn(fallbacks, key) ? substituteMessage(fallbacks[key], substitutions) : key;
}

/** Page-lifetime listener; register before starting the existing settings read. */
export function observeLanguageStorage(): () => void {
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return () => {};
  const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'sync' && changes[LANGUAGE_STORAGE_KEY]) {
      void languageRuntime.set(changes[LANGUAGE_STORAGE_KEY].newValue);
    }
  };
  chrome.storage.onChanged.addListener(onChanged);
  return () => chrome.storage.onChanged.removeListener(onChanged);
}
