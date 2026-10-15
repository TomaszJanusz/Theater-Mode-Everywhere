import { DEFAULT_LANGUAGE, resolveLanguage, type Locale } from '../language';
import { isMessageCatalog, type MessageCatalog } from '../message-catalog';

/** Runs in the background's extension origin, without host CSP or public resources. */
export async function loadLanguageCatalog(value: unknown): Promise<MessageCatalog> {
  const locale = resolveLanguage(value);
  if (locale === DEFAULT_LANGUAGE) throw new Error('Unsupported locale');
  const read = async (id: Locale): Promise<MessageCatalog> => {
    const response = await fetch(chrome.runtime.getURL(`_locales/${id}/messages.json`));
    if (!response.ok) throw new Error('Language resource unavailable');
    const data: unknown = await response.json();
    if (!isMessageCatalog(data)) throw new Error('Invalid language resource');
    return data;
  };
  const english = await read('en');
  return locale === 'en' ? english : { ...english, ...await read(locale) };
}
