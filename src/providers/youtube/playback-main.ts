import { mediaHasSource } from '../../host-play';

import { YOUTUBE_PLAYBACK_REQUEST, YOUTUBE_SEEK_STATE } from './playback-bridge';
import { youtubeSeekForbidden } from './timeline';

export type YoutubePlaybackPlayer = {
  pauseVideo?: () => void;
  playVideo?: () => void;
};

/** YouTube's API half of the seek rule (see `youtubeSeekForbidden`); MAIN only. */
export function youtubeApiForbidsSeeking(player: Element): boolean {
  try {
    return (player as Element & { getProgressState?: () => { allowSeeking?: unknown } | null }).getProgressState?.()?.allowSeeking === false;
  } catch {
    return false;
  }
}

/** MAIN's answer to the isolated world, whose `youtubeSeekForbidden` cannot read the API itself. */
export const seekForbiddenInMain = (video: HTMLVideoElement): boolean => youtubeSeekForbidden(video, youtubeApiForbidsSeeking);

/**
 * The player command that plays or pauses `video` the way YouTube's own button does, or null when the element is the
 * right actor (VOD and live with DVR). On a live stream without DVR YouTube's button is "Stop playback": it pauses,
 * and the next play rejoins the live edge. Media YouTube unloaded (`stopVideo()`, an ad break) only plays again through
 * `playVideo()`; `play()` on the empty element waits forever.
 */
export function youtubePlaybackCommand(
  player: YoutubePlaybackPlayer,
  video: HTMLVideoElement,
  action: 'play' | 'pause',
  seekForbidden: boolean
): 'playVideo' | 'pauseVideo' | null {
  const command = action === 'play' ? 'playVideo' : 'pauseVideo';
  if (typeof player[command] !== 'function') return null;
  if (action === 'play' && !mediaHasSource(video)) return command;
  return seekForbidden ? command : null;
}

/** MAIN's `hostPlayback`: true once YouTube's player was asked. */
export function youtubeHostPlayback(action: 'play' | 'pause', video: HTMLVideoElement): boolean {
  try {
    const player = video.closest('.html5-video-player') as (Element & YoutubePlaybackPlayer) | null;
    const command = player && youtubePlaybackCommand(player, video, action, seekForbiddenInMain(video));
    if (!command) return false;
    player[command]!();
    return true;
  } catch {
    return false;
  }
}

/** What the theater marks on the video it plays; the isolated request names no video, so MAIN checks this one. */
const THEATER_VIDEO = 'video.theater-everywhere-video-active, video[data-theater-everywhere]';

/** The isolated half's request (see `playback-bridge.ts`): cancelled once the player was asked. */
export function installYoutubePlayback(): void {
  // Dispatched on the player and not bubbling: capture at the document sees it first.
  document.addEventListener(YOUTUBE_SEEK_STATE, event => {
    if (event.target instanceof Element && youtubeApiForbidsSeeking(event.target)) event.preventDefault();
  }, true);
  window.addEventListener(YOUTUBE_PLAYBACK_REQUEST, event => {
    const action = (event as CustomEvent<unknown>).detail;
    const video = document.querySelector<HTMLVideoElement>(THEATER_VIDEO);
    if ((action === 'play' || action === 'pause') && video && youtubeHostPlayback(action, video)) event.preventDefault();
  });
}
