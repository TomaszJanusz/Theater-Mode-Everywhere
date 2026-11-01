import type { HostSeekDispatch, HostSeekInput, ProviderTimeline } from '../timeline/types';

import { isDisneyHost } from './hosts';
import {
  DISNEY_CLOCK_EVENT,
  readDisneyChromeDuration,
  readDisneyContentTime,
  readPublishedDisneySnapshot,
  writeDisneyContentTime
} from './page';

/**
 * Hostname of the page, or null when a window exists but has no location.
 * Event-target stubs are not a provider host, and reading their hostname throws.
 */
function providerHostname(): string | null {
  const candidate = (globalThis as { window?: { location?: { hostname?: unknown } } }).window;
  if (!candidate) return '';
  const hostname = candidate.location?.hostname;
  return typeof hostname === 'string' ? hostname : null;
}

function onDisneyHost(): boolean {
  const hostname = providerHostname();
  if (hostname == null) return false;
  return isDisneyHost(hostname);
}

function listenWindow(): Window | null {
  const candidate = (globalThis as typeof globalThis & { window?: Window }).window;
  if (
    !candidate
    || typeof candidate.addEventListener !== 'function'
    || typeof candidate.removeEventListener !== 'function'
  ) {
    return null;
  }
  return candidate;
}

function publishedDisneyClock(video: HTMLVideoElement | null, time: unknown): number | null {
  return writeDisneyContentTime(video, time) ?? readDisneyContentTime(video);
}

function disneyVodDuration(): number | null {
  if (typeof document === 'undefined' || !onDisneyHost()) return null;
  // The chrome fallback scans the overlay's text; only pay for it when the
  // published metadata has no duration.
  return readPublishedDisneySnapshot(document)?.duration ?? readDisneyChromeDuration(document);
}

function disneyMediaSeek(_video: HTMLVideoElement, input: HostSeekInput): HostSeekDispatch | null {
  if (!onDisneyHost()) return null;
  return {
    detail: { time: input.target, resumeAfterSeek: input.resumeAfterSeek },
    rememberResume: true
  };
}

function observeDisneyClock(
  video: HTMLVideoElement | null,
  onClock: (published: number | null) => void
): (() => void) | null {
  if (!onDisneyHost()) return null;
  const target = listenWindow();
  if (!target) return () => {};
  const onDisneyClock = (event: Event) => {
    const eventTime = (event as CustomEvent<{ time?: unknown }>).detail?.time;
    onClock(publishedDisneyClock(video, eventTime));
  };
  target.addEventListener(DISNEY_CLOCK_EVENT, onDisneyClock);
  return () => target.removeEventListener(DISNEY_CLOCK_EVENT, onDisneyClock);
}

export const disneyTimeline: ProviderTimeline = {
  vodDuration() {
    return disneyVodDuration();
  },
  readClock(video) {
    if (!onDisneyHost()) return null;
    return readDisneyContentTime(video);
  },
  observeClock: observeDisneyClock,
  mediaSeek: disneyMediaSeek
};
