import { CompositeMediaAdapter } from './composite-adapter';
import { defaultMediaProviderFlags, type MediaProviderFlags } from './provider-flags';
import { DisneyAdapter } from '../providers/disney/adapter';
import { NativeTextTrackAdapter } from '../providers/native/adapter';
import { NetflixAdapter } from '../providers/netflix/adapter';
import { PatreonAdapter } from '../providers/patreon/adapter';
import { TwitchAdapter } from '../providers/twitch/adapter';
import { VimeoAdapter } from '../providers/vimeo/adapter';
import { YouTubeAdapter } from '../providers/youtube/adapter';
import { shouldAttachProvider } from '../providers/registry';
import type { MediaFeaturesAdapter } from './types';
import { BilibiliAdapter } from '../providers/bilibili/adapter';
import { BilibiliIntlAdapter } from '../providers/bilibili-intl/adapter';
import { TencentAdapter } from '../providers/tencent/adapter';
import { CrunchyrollAdapter } from '../providers/crunchyroll/adapter';
import { coercePlaybackSurface, type PlaybackSurface } from '../playback-surface';
import { createHostCaptionLayoutSource } from '../providers/host-captions';

export function shouldAttachYouTubeAdapter(flags: MediaProviderFlags, hostname?: string): boolean {
  return shouldAttachProvider('youtube', flags, hostname);
}

export function shouldAttachVimeoAdapter(flags: MediaProviderFlags, hostname?: string): boolean {
  return shouldAttachProvider('vimeo', flags, hostname);
}

export function shouldAttachPatreonAdapter(flags: MediaProviderFlags, hostname?: string): boolean {
  return shouldAttachProvider('patreon', flags, hostname);
}

export function shouldAttachTwitchAdapter(flags: MediaProviderFlags, hostname?: string): boolean {
  return shouldAttachProvider('twitch', flags, hostname);
}

export function shouldAttachDisneyAdapter(flags: MediaProviderFlags, hostname?: string): boolean {
  return shouldAttachProvider('disney', flags, hostname);
}

export function shouldAttachNetflixAdapter(flags: MediaProviderFlags, hostname?: string): boolean {
  return shouldAttachProvider('netflix', flags, hostname);
}

export function createMediaFeaturesAdapter(
  media: HTMLVideoElement | PlaybackSurface,
  flags: MediaProviderFlags = defaultMediaProviderFlags()
): MediaFeaturesAdapter {
  const surface = coercePlaybackSurface(media);
  const adapters: MediaFeaturesAdapter[] = [];
  if (surface.nativeMedia instanceof HTMLVideoElement) {
    adapters.push(new NativeTextTrackAdapter(surface.nativeMedia));
  }
  if (shouldAttachYouTubeAdapter(flags)) adapters.push(new YouTubeAdapter());
  if (shouldAttachVimeoAdapter(flags)) adapters.push(new VimeoAdapter());
  if (shouldAttachPatreonAdapter(flags)) adapters.push(new PatreonAdapter());
  if (shouldAttachTwitchAdapter(flags)) adapters.push(new TwitchAdapter());
  if (shouldAttachDisneyAdapter(flags)) adapters.push(new DisneyAdapter());
  if (shouldAttachNetflixAdapter(flags)) adapters.push(new NetflixAdapter());
  if (shouldAttachProvider('bilibili', flags)) adapters.push(new BilibiliAdapter());
  if (shouldAttachProvider('bilibiliIntl', flags)) adapters.push(new BilibiliIntlAdapter());
  if (shouldAttachProvider('tencent', flags)) adapters.push(new TencentAdapter());
  if (shouldAttachProvider('crunchyroll', flags)) adapters.push(new CrunchyrollAdapter());
  return new CompositeMediaAdapter(adapters, createHostCaptionLayoutSource());
}
