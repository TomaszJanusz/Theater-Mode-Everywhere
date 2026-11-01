import type { MediaProviderFlags, MediaProviderId } from '../media-features/provider-flags';
import type { MediaFeaturesAdapter } from '../media-features/types';

import { PROVIDER_CATALOG } from './catalog';
import { descriptorMatchesHost } from './descriptor-hosts';
import { isCrunchyrollHost } from './hosts';
import type { LauncherPlacementFactory } from './launcher-placement';
import { providerRegistry } from './runtime-registration';
import type { WatchPlayback } from './watch-playback';

export const MAIN_WORLD_BOOT_KEY = Symbol.for('theater-everywhere.main-world');
export const MAIN_FETCH_PATCH_KEY = Symbol.for('theater-everywhere.fetch-patched');

export type ProviderId = 'native' | MediaProviderId;

export type ProviderDefinition = {
  id: ProviderId;
  matchesHost: (hostname: string) => boolean;
  watchPlayback?: WatchPlayback;
  launcherPlacement?: LauncherPlacementFactory;
  /** The service adapter, composed by `createMediaFeaturesAdapter` when the provider is attached. */
  createAdapter?: (video: HTMLVideoElement | null) => MediaFeaturesAdapter;
  /** The adapter names no title and leaves it to the page's own metadata, as the native adapter reads it. */
  titleFromPage?: boolean;
};

const legacyDefinitions: ProviderDefinition[] = [
  { id: 'native', matchesHost: () => true },
  { id: 'crunchyroll', matchesHost: (hostname) => isCrunchyrollHost(hostname) },
];

export const PROVIDER_DEFINITIONS: ProviderDefinition[] = [
  ...legacyDefinitions.filter(item => !PROVIDER_CATALOG.some(descriptor => descriptor.id === item.id)),
  ...PROVIDER_CATALOG.map(descriptor => ({
    id: descriptor.id, matchesHost: (hostname: string) => descriptorMatchesHost(descriptor.hosts, hostname),
    get createAdapter() { return providerRegistry.get(descriptor.id)?.createAdapter; },
    get watchPlayback() { return providerRegistry.get(descriptor.id)?.watchPlayback; },
    get titleFromPage() { return providerRegistry.get(descriptor.id)?.titleFromPage; },
    get launcherPlacement() { return providerRegistry.get(descriptor.id)?.launcherPlacement ?? legacyDefinitions.find(item => item.id === descriptor.id)?.launcherPlacement; }
  }))
];

export function providerDefinition(id: ProviderId): ProviderDefinition {
  const found = PROVIDER_DEFINITIONS.find((item) => item.id === id);
  if (!found) throw new Error(`Unknown provider: ${id}`);
  return found;
}

export function matchingProviders(hostname: string): ProviderId[] {
  return PROVIDER_DEFINITIONS.filter((item) => item.matchesHost(hostname)).map((item) => item.id);
}

/** Statically defined providers that harvest responses; registered providers declare `harvest` instead. */
export function shouldPatchMainWorld(hostname: string): boolean {
  // Registered providers declare harvesting.
  return matchingProviders(hostname).some((id) => id !== 'native'
    && legacyDefinitions.some(definition => definition.id === id));
}

export function shouldAttachProvider(id: MediaProviderId, flags: MediaProviderFlags, hostname?: string): boolean {
  if (!flags[id]) return false;
  const host = hostname || (typeof window !== 'undefined' ? window.location.hostname : '');
  return providerDefinition(id).matchesHost(host);
}

/** The first call per target and key wins; a repeat (a second injection into the same world) reports false. */
function markOnce(target: object, key: symbol): boolean {
  const record = target as Record<symbol, unknown>;
  if (record[key]) return false;
  // Hidden and fixed by default; a target that refuses the definition still gets a plain marker.
  if (!Reflect.defineProperty(target, key, { value: true })) record[key] = true;
  return true;
}

export const markMainWorldBooted = (target: object): boolean => markOnce(target, MAIN_WORLD_BOOT_KEY);
export const markFetchPatched = (target: object): boolean => markOnce(target, MAIN_FETCH_PATCH_KEY);
