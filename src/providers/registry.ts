import { isDisneyHost, isPatreonHost, isTwitchHost, isVimeoHost, isYouTubeHost } from './hosts';
import type { MediaProviderFlags, MediaProviderId } from '../media-features/provider-flags';

export const MAIN_WORLD_BOOT_KEY = Symbol.for('theater-everywhere.main-world');
export const MAIN_FETCH_PATCH_KEY = Symbol.for('theater-everywhere.fetch-patched');

export type ProviderId = 'native' | MediaProviderId;

export type ProviderDefinition = {
  id: ProviderId;
  matchesHost: (hostname: string) => boolean;
};

export const PROVIDER_DEFINITIONS: ProviderDefinition[] = [
  { id: 'native', matchesHost: () => true },
  { id: 'youtube', matchesHost: (hostname) => isYouTubeHost(hostname) },
  { id: 'vimeo', matchesHost: (hostname) => isVimeoHost(hostname) },
  { id: 'patreon', matchesHost: (hostname) => isPatreonHost(hostname) },
  { id: 'twitch', matchesHost: (hostname) => isTwitchHost(hostname) },
  { id: 'disney', matchesHost: (hostname) => isDisneyHost(hostname) }
];

export function providerDefinition(id: ProviderId): ProviderDefinition {
  const found = PROVIDER_DEFINITIONS.find((item) => item.id === id);
  if (!found) throw new Error(`Unknown provider: ${id}`);
  return found;
}

export function matchingProviders(hostname: string): ProviderId[] {
  return PROVIDER_DEFINITIONS.filter((item) => item.matchesHost(hostname)).map((item) => item.id);
}

export function shouldPatchMainWorld(hostname: string): boolean {
  return matchingProviders(hostname).some((id) => id !== 'native');
}

export function shouldAttachProvider(id: MediaProviderId, flags: MediaProviderFlags, hostname?: string): boolean {
  if (!flags[id]) return false;
  const host = hostname || (typeof window !== 'undefined' ? window.location.hostname : '');
  return providerDefinition(id).matchesHost(host);
}

export function markMainWorldBooted(target: object): boolean {
  const record = target as Record<symbol, unknown>;
  if (record[MAIN_WORLD_BOOT_KEY]) return false;
  try {
    Object.defineProperty(target, MAIN_WORLD_BOOT_KEY, {
      configurable: false,
      enumerable: false,
      value: true
    });
  } catch {
    record[MAIN_WORLD_BOOT_KEY] = true;
  }
  return true;
}

export function markFetchPatched(target: object): boolean {
  const record = target as Record<symbol, unknown>;
  if (record[MAIN_FETCH_PATCH_KEY]) return false;
  try {
    Object.defineProperty(target, MAIN_FETCH_PATCH_KEY, {
      configurable: false,
      enumerable: false,
      value: true
    });
  } catch {
    record[MAIN_FETCH_PATCH_KEY] = true;
  }
  return true;
}
