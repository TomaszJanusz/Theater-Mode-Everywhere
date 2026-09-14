import { CompositeMediaAdapter } from './composite-adapter';
import { DisneyAdapter } from './disney-adapter';
import { NativeTextTrackAdapter } from './native-adapter';
import { PatreonAdapter } from './patreon-adapter';
import { defaultMediaProviderFlags, type MediaProviderFlags } from './provider-flags';
import { TwitchAdapter } from './twitch-adapter';
import { VimeoAdapter } from './vimeo-adapter';
import { YouTubeAdapter } from './youtube-adapter';
import { shouldAttachProvider } from '../providers/registry';
import type { MediaFeaturesAdapter } from './types';

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

export function createMediaFeaturesAdapter(
  video: HTMLVideoElement,
  flags: MediaProviderFlags = defaultMediaProviderFlags()
): MediaFeaturesAdapter {
  const adapters: MediaFeaturesAdapter[] = [new NativeTextTrackAdapter(video)];
  if (shouldAttachYouTubeAdapter(flags)) adapters.push(new YouTubeAdapter());
  if (shouldAttachVimeoAdapter(flags)) adapters.push(new VimeoAdapter());
  if (shouldAttachPatreonAdapter(flags)) adapters.push(new PatreonAdapter());
  if (shouldAttachTwitchAdapter(flags)) adapters.push(new TwitchAdapter());
  if (shouldAttachDisneyAdapter(flags)) adapters.push(new DisneyAdapter());
  return new CompositeMediaAdapter(adapters);
}
