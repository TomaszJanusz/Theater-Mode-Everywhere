/** Hover previews and the miniplayer: never a theater target, even when nothing else is playable. */
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
 * A theater video the host has moved away from its watch surface: YouTube hides the watch page
 * when navigating to Home and parks playback in the miniplayer.
 */
export function hasLeftPlaybackSurface(video: HTMLVideoElement): boolean {
  return isTransientVideo(video) || Boolean(video.closest('ytd-watch-flexy[hidden]'));
}

/**
 * ThumbPlayer keeps a sourced standby video beside visible playback. Disney
 * mounts a display:none standby first when the next episode replaces the
 * player, then adds the real video.
 */
const STANDBY_VIDEO_HOST_SELECTOR = '.txp_videos_container, disney-web-player';

export function isInactiveStandbyVideo(video: HTMLVideoElement): boolean {
  if (!video.closest(STANDBY_VIDEO_HOST_SELECTOR)) return false;
  const view = video.ownerDocument?.defaultView;
  if (!view) return false;
  if (view.getComputedStyle(video).visibility === 'hidden') return true;
  for (let node: Element | null = video; node; node = node.parentElement) {
    if (view.getComputedStyle(node).display === 'none') return true;
  }
  return false;
}
