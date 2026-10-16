import { createSessionId } from '../protocol/frame-messages';
import { mediaProviderIntegrationEnabled, type MediaProviderId } from '../media-features/provider-flags';
import { isSwitchableTheaterVideo } from '../switchable-videos';
import { PROVIDER_DEFINITIONS } from './registry';

/** URL qualification first, then provider-specific confirmation of the watch player. */
export type WatchPlayback = {
  pageIdentity(url: URL): string | null;
  /** Called only in MAIN; reject auxiliary players and validate available host identity. */
  mainVideo(doc: Document, identity: string): HTMLVideoElement | null;
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

/** Synchronous, string-only bridge, like queue navigation, including Firefox. */
export function confirmProviderWatchVideo(video: HTMLVideoElement): boolean {
  const doc = video.ownerDocument;
  const view = doc.defaultView;
  if (!view) return false;
  const href = view.location.href;
  const requestId = createSessionId();
  view.dispatchEvent(new CustomEvent(WATCH_QUERY, { detail: requestId }));
  const confirmed = doc.querySelector<HTMLVideoElement>(`video[${WATCH_RESPONSE}="${requestId}"]`);
  confirmed?.removeAttribute(WATCH_RESPONSE);
  return confirmed === video && video.isConnected && view.location.href === href;
}

export function installWatchPlaybackQueries(): void {
  window.addEventListener(WATCH_QUERY, (event: Event) => {
    const requestId: unknown = (event as CustomEvent<unknown>).detail;
    if (typeof requestId !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(requestId) || window !== window.top) return;
    const page = readProviderWatchPage(new URL(window.location.href));
    if (!page || !mediaProviderIntegrationEnabled(page.provider)) return;
    try {
      const video = page.playback.mainVideo(document, page.identity);
      if (!video?.isConnected || !isSwitchableTheaterVideo(video)
          || video.paused || video.ended || video.readyState <= 2) return;
      video.setAttribute(WATCH_RESPONSE, requestId);
    } catch {
      // Host APIs can disappear or throw during navigation; fail closed.
    }
  });
}
