import { providerRuntime } from './provider-api';

/**
 * Hover previews and the miniplayer: never a discovered theater target, even when nothing else is
 * playable. The miniplayer's video is entered only through the explicit fallback in
 * `providers/playback-session.ts`.
 */
const TRANSIENT_VIDEO_HOST_SELECTOR = [
  'ytd-video-preview',
  'ytd-moving-thumbnail-renderer',
  'ytd-miniplayer',
  'ytd-inline-playback-player',
  '#inline-player',
  '#inline-preview-player'
].join(',');

/** YouTube preview, miniplayer, and Shorts surfaces are not primary players. */
export const AUXILIARY_VIDEO_HOST_SELECTOR = `${TRANSIENT_VIDEO_HOST_SELECTOR},ytd-shorts,#shorts-player`;

export function isTransientVideo(video: HTMLVideoElement): boolean {
  return Boolean(video.closest(TRANSIENT_VIDEO_HOST_SELECTOR));
}

export function isProviderAuxiliaryVideo(video: HTMLVideoElement): boolean {
  return Boolean(video.closest(AUXILIARY_VIDEO_HOST_SELECTOR));
}

/**
 * YouTube parks the playing player in `ytd-miniplayer` on non-watch pages and marks `ytd-app`
 * while it shows. Closing it clears the mark and moves the paused player back into the hidden
 * watch page; expanding moves it into the visible watch page.
 */
export const MINIPLAYER_SURFACE = 'ytd-app[miniplayer-is-active] ytd-miniplayer';

export function isOnMiniplayerSurface(video: HTMLVideoElement): boolean {
  return Boolean(video.closest(MINIPLAYER_SURFACE)) && !video.closest('[hidden]');
}

/**
 * A theater video the host has moved away from the surface its session started on. A watch
 * session loses it when YouTube hides the watch page on the way to Home and parks playback in
 * the miniplayer. A miniplayer session loses it when closing moves the player back into the
 * hidden watch page or expanding moves it into the visible one; expanding clears the
 * `miniplayer-is-active` mark before the player moves, so on a watch route the player is still
 * on its way while it sits in the miniplayer.
 */
export function hasLeftPlaybackSurface(video: HTMLVideoElement, surface: 'watch' | 'miniplayer' = 'watch', onWatchRoute = false): boolean {
  if (surface === 'watch') return isTransientVideo(video) || Boolean(video.closest('ytd-watch-flexy[hidden]'));
  if (!video.closest('ytd-miniplayer') || video.closest('[hidden]')) return true;
  return !onWatchRoute && !isOnMiniplayerSurface(video);
}

/**
 * Some providers keep a sourced standby beside visible playback, inside the containers they register as
 * `discovery.standbySelector`: a hidden video there is not a candidate.
 */
const standbySelector = () => typeof window === 'undefined' ? '' : providerRuntime('isolated')?.services?.standbyVideoSelector?.() ?? '';

export function isInactiveStandbyVideo(video: HTMLVideoElement): boolean {
  const selector = standbySelector();
  if (!selector || !video.closest(selector)) return false;
  const view = video.ownerDocument?.defaultView;
  if (!view) return false;
  if (view.getComputedStyle(video).visibility === 'hidden') return true;
  for (let node: Element | null = video; node; node = node.parentElement) {
    if (view.getComputedStyle(node).display === 'none') return true;
  }
  return false;
}
