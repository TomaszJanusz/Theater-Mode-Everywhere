import { CompositeMediaAdapter } from './composite-adapter';
import { NativeTextTrackAdapter } from './native-adapter';
import { isPatreonHost, PatreonAdapter } from './patreon-adapter';
import { defaultMediaProviderFlags, type MediaProviderFlags } from './provider-flags';
import { isTwitchHost, TwitchAdapter } from './twitch-adapter';
import { isVimeoHost, VimeoAdapter } from './vimeo-adapter';
import { isYouTubeHost, YouTubeAdapter } from './youtube-adapter';
import type { MediaFeaturesAdapter } from './types';

export function shouldAttachYouTubeAdapter(flags: MediaProviderFlags, hostname?: string): boolean {
  return flags.youtube && isYouTubeHost(hostname);
}

export function shouldAttachVimeoAdapter(flags: MediaProviderFlags, hostname?: string): boolean {
  return flags.vimeo && isVimeoHost(hostname);
}

export function shouldAttachPatreonAdapter(flags: MediaProviderFlags, hostname?: string): boolean {
  return flags.patreon && isPatreonHost(hostname);
}

export function shouldAttachTwitchAdapter(flags: MediaProviderFlags, hostname?: string): boolean {
  return flags.twitch && isTwitchHost(hostname);
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
  return new CompositeMediaAdapter(adapters);
}
