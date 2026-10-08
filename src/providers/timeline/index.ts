import { disneyTimeline } from './disney';
import { netflixTimeline } from './netflix';
import type { HostSeekDispatch, HostSeekInput, TimelineBounds } from './types';
import { youtubeTimeline } from './youtube';

export { LIVE_EDGE_SECONDS, MAX_LIVE_DVR_SECONDS, MIN_LIVE_DVR_SECONDS } from './limits';
export type { HostSeekDispatch, HostSeekInput, MediaSeekDetail, TimelineBounds } from './types';

// Isolated dispatch order. YouTube live does not read its integration flag.
// Disney seeks and reads its clock on the host with the flag ignored. Netflix
// seeks only while its flag is on. MAIN still routes Netflix, then Disney, then YouTube.
const PROVIDERS = [youtubeTimeline, disneyTimeline, netflixTimeline] as const;

export function hostLiveHint(video: HTMLVideoElement): boolean {
  return PROVIDERS.some((provider) => provider.liveHint?.(video) === true);
}

export function hostIsAtLiveHead(video: HTMLVideoElement): boolean {
  return PROVIDERS.some((provider) => provider.isAtLiveHead?.(video) === true);
}

export function readHostLiveBounds(video: HTMLVideoElement): TimelineBounds | null {
  for (const provider of PROVIDERS) {
    const bounds = provider.liveBounds?.(video);
    if (bounds) return bounds;
  }
  return null;
}

export function readHostVodDuration(video: HTMLVideoElement): number | null {
  for (const provider of PROVIDERS) {
    const duration = provider.vodDuration?.(video);
    if (duration != null) return duration;
  }
  return null;
}

/** Disney content clock. Null on every other host. */
export function readProviderClock(video: HTMLVideoElement | null): number | null {
  for (const provider of PROVIDERS) {
    const clock = provider.readClock?.(video);
    if (clock != null) return clock;
  }
  return null;
}

/**
 * Disney publishes through its clock event, writes that time onto the video,
 * and falls back to the dataset clock. Other hosts subscribe to nothing.
 */
export function observeProviderClock(
  video: HTMLVideoElement | null,
  onClock: (published: number | null) => void
): () => void {
  for (const provider of PROVIDERS) {
    const stop = provider.observeClock?.(video, onClock);
    if (stop) return stop;
  }
  return () => {};
}

/** One host at a time. The next host runs only if the caller asks for another attempt. */
export function* hostMediaSeekAttempts(
  video: HTMLVideoElement,
  input: HostSeekInput
): Generator<HostSeekDispatch> {
  for (const provider of PROVIDERS) {
    const plan = provider.mediaSeek?.(video, input);
    if (plan) yield plan;
  }
}

export function hostLiveSeekAttempt(video: HTMLVideoElement): HostSeekDispatch | null {
  for (const provider of PROVIDERS) {
    const plan = provider.liveSeek?.(video);
    if (plan) return plan;
  }
  return null;
}
