import { createSessionId } from '../protocol/frame-messages';
import { mediaProviderIntegrationEnabled, type MediaProviderId } from '../media-features/provider-flags';
import { isSwitchableTheaterVideo } from '../switchable-videos';
import { PROVIDER_DEFINITIONS } from './registry';

/** URL qualification first, then provider-specific confirmation of the watch player. */
export type WatchPlayback = {
  pageIdentity(url: URL): string | null;
  /** Called only in MAIN; reject auxiliary players and validate available host identity. */
  mainVideo(doc: Document, identity: string): HTMLVideoElement | null;
  /**
   * Looser, countdown-only form of `mainVideo` for the window where the host has not yet
   * revealed or sized the watch player (SPA entry from a non-watch page). It may return a
   * hidden, sourceless or unsized content video, but never one whose reported identity
   * differs from the URL's, an ad, or an auxiliary player. Entry still requires `mainVideo`.
   */
  preparingVideo?(doc: Document, identity: string): HTMLVideoElement | null;
  /** Host publications that can make an already-playing watch video ready. */
  refreshEvents?: readonly string[];
  /** Null means attachment is not ready; retry on the next refresh. */
  observe?(video: HTMLVideoElement, onChange: () => void): (() => void) | null;
};

export type ProviderWatchPage = {
  provider: MediaProviderId;
  identity: string;
  playback: WatchPlayback;
};

export function readProviderWatchPage(url: URL): ProviderWatchPage | null {
  for (const definition of PROVIDER_DEFINITIONS) {
    if (definition.id === 'native' || !definition.matchesHost(url.hostname)) continue;
    const playback = definition.watchPlayback;
    const identity = playback?.pageIdentity(url);
    if (playback && identity) return { provider: definition.id, identity, playback };
  }
  return null;
}

export function observeProviderWatchPlaybackChanges(onChange: () => void): () => void {
  const events = new Set(PROVIDER_DEFINITIONS
    .filter(definition => definition.matchesHost(window.location.hostname))
    .flatMap(definition => definition.watchPlayback?.refreshEvents ?? []));
  // Capture document publications as well as events dispatched on window.
  for (const event of events) window.addEventListener(event, onChange, true);
  return () => {
    for (const event of events) window.removeEventListener(event, onChange, true);
  };
}

const WATCH_QUERY = 'theater-everywhere-watch-playback-query';
const WATCH_RESPONSE = 'data-te-watch-playback-response';
const PREPARING_QUERY = 'theater-everywhere-watch-preparing-query';
const PREPARING_RESPONSE = 'data-te-watch-preparing-response';

function confirmThroughBridge(video: HTMLVideoElement, query: string, responseAttribute: string): boolean {
  const doc = video.ownerDocument;
  const view = doc.defaultView;
  if (!view) return false;
  const href = view.location.href;
  const requestId = createSessionId();
  view.dispatchEvent(new CustomEvent(query, { detail: requestId }));
  const confirmed = doc.querySelector<HTMLVideoElement>(`video[${responseAttribute}="${requestId}"]`);
  confirmed?.removeAttribute(responseAttribute);
  return confirmed === video && video.isConnected && view.location.href === href;
}

/** Identity only, never playback state. Synchronous, string-only bridge, like queue navigation, including Firefox. */
export function confirmProviderWatchVideo(video: HTMLVideoElement): boolean {
  return confirmThroughBridge(video, WATCH_QUERY, WATCH_RESPONSE);
}

/** Countdown-only confirmation (`WatchPlayback.preparingVideo`); never sufficient to enter theater. */
export function confirmProviderPreparingVideo(video: HTMLVideoElement): boolean {
  return confirmThroughBridge(video, PREPARING_QUERY, PREPARING_RESPONSE);
}

function installQuery(query: string, responseAttribute: string,
  confirm: (page: ProviderWatchPage) => HTMLVideoElement | null | undefined): void {
  window.addEventListener(query, (event: Event) => {
    const requestId: unknown = (event as CustomEvent<unknown>).detail;
    if (typeof requestId !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(requestId) || window !== window.top) return;
    const page = readProviderWatchPage(new URL(window.location.href));
    if (!page || !mediaProviderIntegrationEnabled(page.provider)) return;
    try {
      const video = confirm(page);
      if (video?.isConnected) video.setAttribute(responseAttribute, requestId);
    } catch {
      // Host APIs can disappear or throw during navigation; fail closed.
    }
  });
}

export function installWatchPlaybackQueries(): void {
  // Identity only: whether the video is playing or still loading is the caller's decision.
  installQuery(WATCH_QUERY, WATCH_RESPONSE, page => {
    const video = page.playback.mainVideo(document, page.identity);
    return video && isSwitchableTheaterVideo(video) ? video : null;
  });
  installQuery(PREPARING_QUERY, PREPARING_RESPONSE, page => page.playback.preparingVideo?.(document, page.identity));
}
