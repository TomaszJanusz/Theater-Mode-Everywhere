import { providerRegistry } from '../runtime-registration';

import type { HostSeekDispatch, HostSeekInput, ProviderTimeline, TimelineBounds } from './types';

export { LIVE_EDGE_SECONDS, MAX_LIVE_DVR_SECONDS, MIN_LIVE_DVR_SECONDS } from '../timeline-limits';
export type { HostSeekDispatch, HostSeekInput, MediaSeekDetail, TimelineBounds } from './types';

// Registered providers in registration order; each decides whether its integration flag applies (YouTube's live
// timeline and Disney+'s clock ignore it, Netflix seeks only while it is on). MAIN routes the registered seeks.
// Read per call: registration closes before the runtime starts.
function providers(): ProviderTimeline[] {
  return providerRegistry.all().flatMap(hooks => hooks.timeline ?? []);
}

export function hostLiveHint(video: HTMLVideoElement): boolean {
  return providers().some((provider) => provider.liveHint?.(video) === true);
}

export function hostIsAtLiveHead(video: HTMLVideoElement): boolean {
  return providers().some((provider) => provider.isAtLiveHead?.(video) === true);
}

export function readHostLiveBounds(video: HTMLVideoElement): TimelineBounds | null {
  for (const provider of providers()) {
    const bounds = provider.liveBounds?.(video);
    if (bounds) return bounds;
  }
  return null;
}

export function readHostVodDuration(video: HTMLVideoElement): number | null {
  for (const provider of providers()) {
    const duration = provider.vodDuration?.(video);
    if (duration != null) return duration;
  }
  return null;
}

/** A provider's content clock, such as Disney+'s; null where none registers one. */
export function readProviderClock(video: HTMLVideoElement | null): number | null {
  for (const provider of providers()) {
    const clock = provider.readClock?.(video);
    if (clock != null) return clock;
  }
  return null;
}

/** A provider's clock publication, such as Disney+'s clock event; other hosts subscribe to nothing. */
export function observeProviderClock(
  video: HTMLVideoElement | null,
  onClock: (published: number | null) => void
): () => void {
  for (const provider of providers()) {
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
  for (const provider of providers()) {
    const plan = provider.mediaSeek?.(video, input);
    if (plan) yield plan;
  }
}

export function hostLiveSeekAttempt(video: HTMLVideoElement): HostSeekDispatch | null {
  for (const provider of providers()) {
    const plan = provider.liveSeek?.(video);
    if (plan) return plan;
  }
  return null;
}
