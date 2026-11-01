import { coercePlaybackSurface, type PlaybackSurface } from '../playback-surface';
import { CrunchyrollAdapter } from '../providers/crunchyroll/adapter';
import { DisneyAdapter } from '../providers/disney/adapter';
import { createHostCaptionLayoutSource } from '../providers/host-captions';
import { NativeTextTrackAdapter } from '../providers/native/adapter';
import { PROVIDER_DEFINITIONS, shouldAttachProvider } from '../providers/registry';
import { TencentAdapter } from '../providers/tencent/adapter';

import { CompositeMediaAdapter } from './composite-adapter';
import { defaultMediaProviderFlags, type MediaProviderFlags } from './provider-flags';
import type { MediaFeaturesAdapter } from './types';


export function shouldAttachYouTubeAdapter(flags: MediaProviderFlags, hostname?: string): boolean {
  return shouldAttachProvider('youtube', flags, hostname);
}

export function shouldAttachDisneyAdapter(flags: MediaProviderFlags, hostname?: string): boolean {
  return shouldAttachProvider('disney', flags, hostname);
}

/** Attached providers whose adapter leaves the title to the page's metadata. */
function pageTitledProviders(flags: MediaProviderFlags): number {
  return PROVIDER_DEFINITIONS.filter(({ id, createAdapter, titleFromPage }) => id !== 'native' && createAdapter && titleFromPage && shouldAttachProvider(id, flags)).length;
}

/** Adapters that providers supply through their registry definition. */
function registeredAdapters(flags: MediaProviderFlags, video: HTMLVideoElement | null): MediaFeaturesAdapter[] {
  return PROVIDER_DEFINITIONS.flatMap(({ id, createAdapter }) => id !== 'native' && createAdapter && shouldAttachProvider(id, flags) ? [createAdapter(video)] : []);
}

export function createMediaFeaturesAdapter(
  media: HTMLVideoElement | PlaybackSurface,
  flags: MediaProviderFlags = defaultMediaProviderFlags()
): MediaFeaturesAdapter {
  const surface = coercePlaybackSurface(media);
  const adapters: MediaFeaturesAdapter[] = [];
  if (shouldAttachDisneyAdapter(flags)) adapters.push(new DisneyAdapter());
  if (shouldAttachProvider('tencent', flags)) adapters.push(new TencentAdapter());
  if (shouldAttachProvider('crunchyroll', flags)) adapters.push(new CrunchyrollAdapter());
  adapters.push(...registeredAdapters(flags, surface.nativeMedia instanceof HTMLVideoElement ? surface.nativeMedia : null));
  if (surface.nativeMedia instanceof HTMLVideoElement) {
    // Native stays first so a service title outranks it; page metadata is only a fallback without one.
    // A provider that leaves its title to the page does not count as a service title.
    adapters.unshift(new NativeTextTrackAdapter(surface.nativeMedia, adapters.length === pageTitledProviders(flags)));
  }
  return new CompositeMediaAdapter(adapters, createHostCaptionLayoutSource());
}
