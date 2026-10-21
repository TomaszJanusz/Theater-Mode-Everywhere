import { createSessionId } from '../protocol/frame-messages';
import { mediaProviderIntegrationEnabled, type MediaProviderFlags, type MediaProviderId } from '../media-features/provider-flags';
import { isSwitchableTheaterVideo } from '../switchable-videos';
import { PROVIDER_DEFINITIONS } from './registry';

/** URL qualification first, then provider-specific confirmation of the watch player. */
export type WatchPlayback = {
  pageIdentity(url: URL): string | null;
  /** Manual playback routes may lack the stable content identity required for automatic entry. */
  playbackPage?(url: URL): boolean;
  /** Called only in MAIN; reject auxiliary players and validate available host identity.
   * Replacement checks also accept paused primary media; automatic entry keeps its readiness rules.
   */
  mainVideo(doc: Document, identity: string, purpose?: 'replacement'): HTMLVideoElement | null;
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

/**
 * Single-page sites keep the player element across history traversal and may not hide it, so
 * element removal alone cannot signal that navigation left the watch page.
 */
export function leftProviderWatchPage(enteredOnWatchPage: boolean, href: string): boolean {
  if (!enteredOnWatchPage) return false;
  const url = new URL(href);
  return !readProviderWatchPage(url) && !PROVIDER_DEFINITIONS.some(definition =>
    definition.matchesHost(url.hostname) && definition.watchPlayback?.playbackPage?.(url));
}

export type AutoTheaterAvailability = 'available' | 'unsupported' | 'integrationOff';

/** Mirrors the gates `readProviderWatchPage` and the runtime apply, without needing a watch URL, so menus can explain them. */
export function autoTheaterAvailability(hostname: string, flags: MediaProviderFlags, topLevel: boolean): AutoTheaterAvailability {
  if (!topLevel) return 'unsupported';
  const providers = PROVIDER_DEFINITIONS.filter(definition =>
    definition.id !== 'native' && definition.watchPlayback && definition.matchesHost(hostname));
  if (!providers.length) return 'unsupported';
  return providers.some(definition => flags[definition.id as MediaProviderId]) ? 'available' : 'integrationOff';
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
const REPLACEMENT_QUERY = 'theater-everywhere-watch-replacement-query';
const REPLACEMENT_RESPONSE = 'data-te-watch-replacement-response';
const PREPARING_QUERY = 'theater-everywhere-watch-preparing-query';
const PREPARING_RESPONSE = 'data-te-watch-preparing-response';

function confirmThroughBridge(video: HTMLVideoElement, query: string, responseAttribute: string): boolean {
  const doc = video.ownerDocument;
  const view = doc.defaultView;
  if (!view) return false;
  const href = view.location.href;
  const requestId = createSessionId();
  view.dispatchEvent(new CustomEvent(query, { detail: requestId }));
  // Read the attribute on this element: a document query cannot see videos in shadow roots.
  const confirmed = video.getAttribute(responseAttribute) === requestId;
  video.removeAttribute(responseAttribute);
  return confirmed && video.isConnected && view.location.href === href;
}

/** Identity only, never playback state. Synchronous, string-only bridge, like queue navigation, including Firefox. */
export function confirmProviderWatchVideo(video: HTMLVideoElement): boolean {
  return confirmThroughBridge(video, WATCH_QUERY, WATCH_RESPONSE);
}

/** Manual sessions need the same identity check even with the integration disabled. */
export function confirmProviderWatchReplacement(video: HTMLVideoElement): boolean {
  return confirmThroughBridge(video, REPLACEMENT_QUERY, REPLACEMENT_RESPONSE);
}

/** Countdown-only confirmation (`WatchPlayback.preparingVideo`); never sufficient to enter theater. */
export function confirmProviderPreparingVideo(video: HTMLVideoElement): boolean {
  return confirmThroughBridge(video, PREPARING_QUERY, PREPARING_RESPONSE);
}

function installQuery(query: string, responseAttribute: string,
  confirm: (page: ProviderWatchPage) => HTMLVideoElement | null | undefined, requireIntegration = true): void {
  window.addEventListener(query, (event: Event) => {
    const requestId: unknown = (event as CustomEvent<unknown>).detail;
    if (typeof requestId !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(requestId) || window !== window.top) return;
    const page = readProviderWatchPage(new URL(window.location.href));
    if (!page || (requireIntegration && !mediaProviderIntegrationEnabled(page.provider))) return;
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
  const mainVideo = (page: ProviderWatchPage, purpose?: 'replacement'): HTMLVideoElement | null => {
    const video = page.playback.mainVideo(document, page.identity, purpose);
    return video && isSwitchableTheaterVideo(video) ? video : null;
  };
  installQuery(WATCH_QUERY, WATCH_RESPONSE, mainVideo);
  installQuery(REPLACEMENT_QUERY, REPLACEMENT_RESPONSE, page => mainVideo(page, 'replacement'), false);
  installQuery(PREPARING_QUERY, PREPARING_RESPONSE, page => page.playback.preparingVideo?.(document, page.identity));
}
