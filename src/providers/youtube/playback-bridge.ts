/**
 * Isolated -> MAIN: play or pause through YouTube's player API, which only MAIN can reach. The detail is the action
 * as a string (Firefox hides content-script objects from page code); MAIN cancels the event once the player was asked,
 * so the caller leaves the element alone.
 */
export const YOUTUBE_PLAYBACK_REQUEST = 'theater-everywhere-youtube-playback';

export function requestYoutubePlayback(action: 'play' | 'pause'): boolean {
  return !window.dispatchEvent(new CustomEvent(YOUTUBE_PLAYBACK_REQUEST, { cancelable: true, detail: action }));
}
