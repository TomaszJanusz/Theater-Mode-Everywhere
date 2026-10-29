
import type { MediaProviderFlags, MediaProviderId } from '../media-features/provider-flags';
import type { MediaFeaturesAdapter } from '../media-features/types';
import { VikiAdapter } from '../media-features/viki-adapter';

import { bilibiliWatchPlayback } from './bilibili/watch-playback';
import { bilibiliIntlWatchPlayback } from './bilibili-intl/watch-playback';
import { PROVIDER_CATALOG } from './catalog';
import { descriptorMatchesHost } from './descriptor-hosts';
import { disneyWatchPlayback } from './disney/watch-playback';
import { isBilibiliHost, isBilibiliIntlHost, isCrunchyrollHost, isDisneyHost, isIqiyiHost, isNetflixHost, isPatreonHost, isTencentHost, isTwitchHost, isVikiHost, isVimeoHost } from './hosts';
import { IqiyiAdapter } from './iqiyi/adapter';
import { iqiyiWatchPlayback } from './iqiyi/watch-playback';
import type { LauncherPlacementFactory } from './launcher-placement';
import { netflixWatchPlayback } from './netflix/watch-playback';
import { patreonWatchPlayback } from './patreon/watch-playback';
import { providerRegistry } from './runtime-registration';
import { twitchWatchPlayback } from './twitch/watch-playback';
import { vikiWatchPlayback } from './viki/watch-playback';
import { vimeoWatchPlayback } from './vimeo/watch-playback';
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

export const PROVIDER_DEFINITIONS: ProviderDefinition[] = [
  { id: 'native', matchesHost: () => true },
  { id: 'vimeo', matchesHost: (hostname) => isVimeoHost(hostname), watchPlayback: vimeoWatchPlayback },
  { id: 'patreon', matchesHost: (hostname) => isPatreonHost(hostname), watchPlayback: patreonWatchPlayback },
  { id: 'twitch', matchesHost: (hostname) => isTwitchHost(hostname), watchPlayback: twitchWatchPlayback },
  { id: 'disney', matchesHost: (hostname) => isDisneyHost(hostname), watchPlayback: disneyWatchPlayback },
  { id: 'netflix', matchesHost: (hostname) => isNetflixHost(hostname), watchPlayback: netflixWatchPlayback },
  { id: 'bilibili', matchesHost: (hostname) => isBilibiliHost(hostname), watchPlayback: bilibiliWatchPlayback },
  { id: 'bilibiliIntl', matchesHost: (hostname) => isBilibiliIntlHost(hostname), watchPlayback: bilibiliIntlWatchPlayback },
  { id: 'tencent', matchesHost: (hostname) => isTencentHost(hostname) },
  { id: 'crunchyroll', matchesHost: (hostname) => isCrunchyrollHost(hostname) },
  { id: 'iqiyi', matchesHost: (hostname) => isIqiyiHost(hostname), createAdapter: (video) => new IqiyiAdapter(video), watchPlayback: iqiyiWatchPlayback },
  ...PROVIDER_CATALOG.map(descriptor => ({
    id: descriptor.id, matchesHost: (hostname: string) => descriptorMatchesHost(descriptor.hosts, hostname),
    get createAdapter() { return providerRegistry.get(descriptor.id)?.createAdapter; },
    get watchPlayback() { return providerRegistry.get(descriptor.id)?.watchPlayback; },
    get launcherPlacement() { return providerRegistry.get(descriptor.id)?.launcherPlacement; }
  })),
  { id: 'viki', matchesHost: (hostname) => isVikiHost(hostname), createAdapter: () => new VikiAdapter(), titleFromPage: true, watchPlayback: vikiWatchPlayback }
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
  // Bilibili requests scoped metadata directly. Tencent harvests getvinfo. iQIYI, SOOP and Viki read only the page and its own responses.
  return matchingProviders(hostname).some((id) => id !== 'native' && id !== 'bilibili' && id !== 'bilibiliIntl' && id !== 'iqiyi' && id !== 'soop' && id !== 'viki');
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
