import { mediaHasSource } from '../../host-play';

import { YOUTUBE_PLAYBACK_REQUEST } from './playback-bridge';

export type YoutubePlaybackPlayer = {
  getProgressState?: () => { allowSeeking?: boolean } | null;
  pauseVideo?: () => void;
  playVideo?: () => void;
};

/**
 * The player command that plays or pauses `video` the way YouTube's own button does, or null when the element is the
 * right actor (VOD and live with DVR). On a live stream without DVR YouTube's button is "Stop playback": it pauses,
 * and the next play rejoins the live edge. Media YouTube unloaded (`stopVideo()`, an ad break) only plays again through
 * `playVideo()`; `play()` on the empty element waits forever.
 */
export function youtubePlaybackCommand(
  player: YoutubePlaybackPlayer,
  video: HTMLVideoElement,
  action: 'play' | 'pause'
): 'playVideo' | 'pauseVideo' | null {
  const command = action === 'play' ? 'playVideo' : 'pauseVideo';
  if (typeof player[command] !== 'function') return null;
  if (action === 'play' && !mediaHasSource(video)) return command;
  return player.getProgressState?.()?.allowSeeking === false ? command : null;
}

/** MAIN's `hostPlayback`: true once YouTube's player was asked. */
export function youtubeHostPlayback(action: 'play' | 'pause', video: HTMLVideoElement): boolean {
  try {
    const player = video.closest('.html5-video-player') as (Element & YoutubePlaybackPlayer) | null;
    const command = player && youtubePlaybackCommand(player, video, action);
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
  window.addEventListener(YOUTUBE_PLAYBACK_REQUEST, event => {
    const action = (event as CustomEvent<unknown>).detail;
    const video = document.querySelector<HTMLVideoElement>(THEATER_VIDEO);
    if ((action === 'play' || action === 'pause') && video && youtubeHostPlayback(action, video)) event.preventDefault();
  });
}
