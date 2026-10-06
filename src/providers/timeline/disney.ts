import {
  DISNEY_CLOCK_EVENT,
  isDisneyHost,
  readDisneyChromeDuration,
  readDisneyContentTime,
  readPublishedDisneySnapshot,
  writeDisneyContentTime
} from '../../media-features/parsers/disney-page';
import { providerHostname } from './page-host';
import type { HostSeekDispatch, HostSeekInput, ProviderTimeline } from './types';

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
  const harvested = readPublishedDisneySnapshot(document)?.duration;
  const chrome = readDisneyChromeDuration(document);
  return harvested ?? chrome ?? null;
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
