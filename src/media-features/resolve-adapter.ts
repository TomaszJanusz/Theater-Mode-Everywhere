import { CompositeMediaAdapter } from './composite-adapter';
import { NativeTextTrackAdapter } from './native-adapter';
import { isVimeoHost, VimeoAdapter } from './vimeo-adapter';
import { isYouTubeHost, YouTubeAdapter } from './youtube-adapter';
import type { MediaFeaturesAdapter } from './types';

export function createMediaFeaturesAdapter(video: HTMLVideoElement): MediaFeaturesAdapter {
  const adapters: MediaFeaturesAdapter[] = [new NativeTextTrackAdapter(video)];
  if (isYouTubeHost()) adapters.push(new YouTubeAdapter());
  if (isVimeoHost()) adapters.push(new VimeoAdapter());
  return new CompositeMediaAdapter(adapters);
}
