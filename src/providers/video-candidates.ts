/** YouTube preview, miniplayer, and Shorts surfaces are not primary players. */
export const AUXILIARY_VIDEO_HOST_SELECTOR = [
  'ytd-video-preview',
  'ytd-moving-thumbnail-renderer',
  'ytd-miniplayer',
  'ytd-inline-playback-player',
  'ytd-shorts',
  '#inline-player',
  '#inline-preview-player',
  '#shorts-player'
].join(',');

export function isProviderAuxiliaryVideo(video: HTMLVideoElement): boolean {
  return Boolean(video.closest(AUXILIARY_VIDEO_HOST_SELECTOR));
}

/** ThumbPlayer keeps a sourced standby video beside visible playback. */
export function isInactiveThumbPlayerVideo(video: HTMLVideoElement): boolean {
  if (!video.closest('.txp_videos_container')) return false;
  const view = video.ownerDocument?.defaultView;
  if (!view) return false;
  const style = view.getComputedStyle(video);
  return style.visibility === 'hidden' || style.display === 'none';
}
