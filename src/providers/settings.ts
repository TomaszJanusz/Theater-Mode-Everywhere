import { settingBoolean, settingsRecord as record } from './settings-values';

/** Descriptor-owned settings. Readers receive declarations, so host-only defaults stay out of shared bundles. */
export interface ProviderSetting {
  id: string;
  type: 'boolean';
  default: boolean;
  label: string;
  description: string;
}
export interface SettingsProvider { id: string; settings: readonly ProviderSetting[] }
export type ProviderSettings = Record<string, Record<string, boolean>>;
export const PROVIDER_SETTINGS_KEY = 'providerSettings';

export function resolveProviderSettings(value: unknown, providers: readonly SettingsProvider[]): ProviderSettings {
  const stored = record(value);
  return Object.fromEntries(providers.map(provider => [provider.id, Object.fromEntries(provider.settings.map(setting => {
    const value = record(stored[provider.id])[setting.id];
    return [setting.id, settingBoolean(value, setting.default)];
  }))]));
}

/**
 * One sync namespace, no writes on load, and no stale initial read after a storage event or disposal.
 * Without extension storage (a page harness, a script orphaned by an update) the declared defaults apply and writes reject.
 */
export function createProviderSettings(providers: readonly SettingsProvider[]) {
  const storage = typeof chrome === 'undefined' ? undefined : chrome.storage;
  let raw: unknown;
  let values = resolveProviderSettings(raw, providers);
  let revision = 0;
  let disposed = false;
  let loaded = false;
  const listeners = new Set<() => void>();
  const apply = (value: unknown) => {
    raw = value;
    values = resolveProviderSettings(raw, providers);
    for (const changed of listeners) changed();
  };
  const onStorage = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (disposed || area !== 'sync' || !(PROVIDER_SETTINGS_KEY in changes)) return;
    revision++;
    apply(changes[PROVIDER_SETTINGS_KEY].newValue);
  };
  storage?.onChanged.addListener(onStorage);
  // Async, so a storage API that throws rejects `ready` instead of breaking the caller's construction.
  const ready = (async () => {
    const data = storage ? await storage.sync.get(PROVIDER_SETTINGS_KEY) : {};
    if (disposed) return;
    loaded = true;
    apply(revision ? raw : data[PROVIDER_SETTINGS_KEY]);
  })();
  let pending = Promise.resolve();
  const set = (providerId: string, settingId: string, value: boolean): Promise<void> => {
    const setting = providers.find(provider => provider.id === providerId)?.settings.find(setting => setting.id === settingId);
    if (!setting || typeof value !== 'boolean') return Promise.reject(new Error('Unknown provider setting'));
    if (!storage) return Promise.reject(new Error('Extension storage is unavailable'));
    const write = async () => {
      await ready;
      if (disposed) return;
      // Refresh before writing: preserve other providers, including settings from a newer extension version.
      const beforeRead = revision;
      const latest = await storage.sync.get(PROVIDER_SETTINGS_KEY);
      if (disposed) return;
      const current = beforeRead === revision ? latest[PROVIDER_SETTINGS_KEY] : raw;
      if (resolveProviderSettings(current, providers)[providerId][settingId] === value) { apply(current); return; }
      const next = { ...record(current), [providerId]: { ...record(record(current)[providerId]), [settingId]: value } };
      const beforeWrite = revision;
      await storage.sync.set({ [PROVIDER_SETTINGS_KEY]: next });
      if (!disposed && revision === beforeWrite) apply(next);
    };
    const result = pending.then(write);
    pending = result.catch(() => {});
    return result;
  };
  return {
    ready,
    get loaded() { return loaded; },
    get values() { return values; },
    set,
    subscribe(changed: () => void) { listeners.add(changed); return () => { listeners.delete(changed); }; },
    dispose() {
      if (disposed) return;
      disposed = true;
      listeners.clear();
      storage?.onChanged.removeListener(onStorage);
    }
  };
}
export type ProviderSettingsStore = ReturnType<typeof createProviderSettings>;
