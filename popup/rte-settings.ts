import {
  MEDIA_PROVIDER_FLAG_KEYS, mediaProviderFlagLegacyDefaults, mediaProviderFlagStorageKeys,
  resolveMediaProviderFlags
} from '../src/media-features/provider-flags';
import { matchingProviders } from '../src/providers/registry';

/** The tab's service owns this switch, including on a directly opened embed URL.
 * Unknown top-level hosts keep it hidden; embedded services retain their own flags.
 */
export function setupPopupRte(hostname: string): () => void {
  const card = document.getElementById('rich-theater-experience-card')!;
  const toggle = document.getElementById('rich-theater-experience-toggle') as HTMLInputElement;
  const provider = matchingProviders(hostname).find(id => id !== 'native');
  card.hidden = !provider;
  toggle.disabled = true;
  if (!provider) return () => {};

  const key = MEDIA_PROVIDER_FLAG_KEYS[provider];
  const keys = mediaProviderFlagStorageKeys();
  let stored: Record<string, unknown> = {};
  let disposed = false;
  let ready = false;
  let saving = false;
  const render = () => {
    if (disposed) return;
    toggle.checked = resolveMediaProviderFlags(stored)[provider];
    toggle.disabled = !ready || saving;
  };
  const onStorage = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (disposed || area !== 'sync' || !keys.some(key => key in changes)) return;
    for (const key of keys) if (key in changes) stored[key] = changes[key].newValue;
    render();
  };
  const onChange = async () => {
    if (!ready || saving || disposed) return;
    const enabled = toggle.checked;
    saving = true;
    toggle.disabled = true;
    try {
      await chrome.storage.sync.set({ [key]: enabled });
      // Storage listeners in the runtime (including frames) own live rebinding.
    } catch (error) {
      console.error('Error saving Rich Theater Experience setting:', error);
    } finally {
      saving = false;
      render();
    }
  };
  chrome.storage.onChanged.addListener(onStorage);
  toggle.addEventListener('change', onChange);
  void (async () => {
    try {
      const initial = await chrome.storage.sync.get(keys);
      if (disposed) return;
      // Events received while reading win over the initial snapshot, even removals.
      stored = { ...initial, ...stored };
      const legacyDefaults = mediaProviderFlagLegacyDefaults(stored);
      if (Object.keys(legacyDefaults).length) {
        await chrome.storage.sync.set(legacyDefaults);
        if (disposed) return;
      }
      ready = true;
      render();
    } catch (error) {
      console.error('Error loading Rich Theater Experience setting:', error);
    }
  })();
  return () => {
    disposed = true;
    chrome.storage.onChanged.removeListener(onStorage);
    toggle.removeEventListener('change', onChange);
  };
}
