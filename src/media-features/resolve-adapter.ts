import { CompositeMediaAdapter } from './composite-adapter';
import { NativeTextTrackAdapter } from './native-adapter';
import { defaultMediaProviderFlags, type MediaProviderFlags } from './provider-flags';
import { isVimeoHost, VimeoAdapter } from './vimeo-adapter';
import { isYouTubeHost, YouTubeAdapter } from './youtube-adapter';
import type { MediaFeaturesAdapter } from './types';

export function shouldAttachYouTubeAdapter(flags: MediaProviderFlags, hostname?: string): boolean {
  return flags.youtube && isYouTubeHost(hostname);
}

export function shouldAttachVimeoAdapter(flags: MediaProviderFlags, hostname?: string): boolean {
  return flags.vimeo && isVimeoHost(hostname);
}

export function createMediaFeaturesAdapter(
  video: HTMLVideoElement,
  flags: MediaProviderFlags = defaultMediaProviderFlags()
): MediaFeaturesAdapter {
  const adapters: MediaFeaturesAdapter[] = [new NativeTextTrackAdapter(video)];
  if (shouldAttachYouTubeAdapter(flags)) adapters.push(new YouTubeAdapter());
  if (shouldAttachVimeoAdapter(flags)) adapters.push(new VimeoAdapter());
  return new CompositeMediaAdapter(adapters);
}
