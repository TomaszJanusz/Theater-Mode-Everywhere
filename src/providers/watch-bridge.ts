import { createSessionId } from '../protocol/frame-messages';

// The isolated world's side of the watch-playback bridge: stateless, so provider entries can bundle it.
// MAIN answers in `installWatchPlaybackQueries` (providers/watch-playback.ts).

export const WATCH_QUERY = 'theater-everywhere-watch-playback-query';
export const WATCH_RESPONSE = 'data-te-watch-playback-response';
export const REPLACEMENT_QUERY = 'theater-everywhere-watch-replacement-query';
export const REPLACEMENT_RESPONSE = 'data-te-watch-replacement-response';
export const PREPARING_QUERY = 'theater-everywhere-watch-preparing-query';
export const PREPARING_RESPONSE = 'data-te-watch-preparing-response';
export const MINIPLAYER_QUERY = 'theater-everywhere-miniplayer-query';
export const MINIPLAYER_RESPONSE = 'data-te-miniplayer-response';

/** Host content ids that may cross the bridge after a request id. */
export const CONTENT_IDENTITY = /^[\w-]{1,64}$/;

export const isRequestId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(value);

/** The response after the request id, or null when MAIN did not answer for this element. */
function askBridge(video: HTMLVideoElement, query: string, responseAttribute: string): string | null {
  const doc = video.ownerDocument;
  const view = doc.defaultView;
  if (!view) return null;
  const href = view.location.href;
  const requestId = createSessionId();
  view.dispatchEvent(new CustomEvent(query, { detail: requestId }));
  // Read the attribute on this element: a document query cannot see videos in shadow roots.
  const response = video.getAttribute(responseAttribute);
  video.removeAttribute(responseAttribute);
  if (!response?.startsWith(requestId) || !video.isConnected || view.location.href !== href) return null;
  return response.slice(requestId.length);
}

function confirmThroughBridge(video: HTMLVideoElement, query: string, responseAttribute: string): boolean {
  return askBridge(video, query, responseAttribute) === '';
}

/**
 * Null unless MAIN confirmed the main watch video; then its content identity
 * (`WatchPlayback.contentIdentity`), or '' when the provider reports none.
 */
export function readProviderWatchContent(video: HTMLVideoElement): string | null {
  const response = askBridge(video, WATCH_QUERY, WATCH_RESPONSE);
  if (response === '' || response === null) return response;
  const content = response.slice(1);
  return response.startsWith(':') && CONTENT_IDENTITY.test(content) ? content : null;
}

/** Identity only, never playback state. Synchronous, string-only bridge, like queue navigation, including Firefox. */
export function confirmProviderWatchVideo(video: HTMLVideoElement): boolean {
  return readProviderWatchContent(video) !== null;
}

/** Manual sessions need the same identity check even with the integration disabled. */
export function confirmWatchReplacement(video: HTMLVideoElement): boolean {
  return confirmThroughBridge(video, REPLACEMENT_QUERY, REPLACEMENT_RESPONSE);
}

/** Countdown-only confirmation (`WatchPlayback.preparingVideo`); never sufficient to enter theater. */
export function confirmProviderPreparingVideo(video: HTMLVideoElement): boolean {
  return confirmThroughBridge(video, PREPARING_QUERY, PREPARING_RESPONSE);
}

/**
 * The content identity of a video the host parked in its miniplayer, as its player reports it, or
 * null. Same string-only, top-frame, href-checked bridge as the watch queries; it works with the
 * integration disabled because manual sessions need it.
 */
export function readMiniplayerIdentity(video: HTMLVideoElement): string | null {
  const response = askBridge(video, MINIPLAYER_QUERY, MINIPLAYER_RESPONSE);
  const identity = response?.startsWith(':') ? response.slice(1) : '';
  return CONTENT_IDENTITY.test(identity) ? identity : null;
}
