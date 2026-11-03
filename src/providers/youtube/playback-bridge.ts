/**
 * Isolated -> MAIN: play or pause through YouTube's player API, which only MAIN can reach. The detail is the action
 * as a string (Firefox hides content-script objects from page code); MAIN cancels the event once the player was asked,
 * so the caller leaves the element alone.
 */
export const YOUTUBE_PLAYBACK_REQUEST = 'theater-everywhere-youtube-playback';

export function requestYoutubePlayback(action: 'play' | 'pause'): boolean {
  return !window.dispatchEvent(new CustomEvent(YOUTUBE_PLAYBACK_REQUEST, { cancelable: true, detail: action }));
}

/**
 * Isolated -> MAIN, dispatched on the player element: MAIN cancels it when YouTube's own API says the stream forbids
 * seeking (`getProgressState().allowSeeking === false`), which only MAIN can read. Synchronous, like the request above.
 */
export const YOUTUBE_SEEK_STATE = 'theater-everywhere-youtube-seek-state';

export function askMainForbidsSeeking(player: Element): boolean {
  try {
    return !player.dispatchEvent(new CustomEvent(YOUTUBE_SEEK_STATE, { cancelable: true }));
  } catch {
    // A player without the DOM event API (test doubles) has no MAIN half to ask.
    return false;
  }
}
