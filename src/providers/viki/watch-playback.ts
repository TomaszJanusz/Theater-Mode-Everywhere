import { vikiLoadedVideoId, vikiVideoId } from '../../media-features/parsers/viki';
import type { WatchPlayback } from '../watch-playback';

/**
 * The episode's only Video.js video. Viki rebuilds the player on every episode change and the
 * element carries no id, so identity is the manifest the page requested last: while the URL names
 * another episode, the old video is rejected. Ads share this element and stay part of the visit,
 * as on Netflix and Disney+. Where the resource timeline holds no manifest (its buffer fills on
 * long sessions) entry fails closed.
 */
function episodeVideo(doc: Document, identity: string): HTMLVideoElement | null {
  const videos = doc.querySelectorAll<HTMLVideoElement>('#vmplayer_id.video-js video.vjs-tech');
  if (videos.length !== 1 || doc.querySelectorAll('video').length !== 1) return null;
  const names = (doc.defaultView ?? window).performance.getEntriesByType('resource').map(entry => entry.name);
  return vikiLoadedVideoId(names) === identity && Number.isFinite(videos[0].duration) ? videos[0] : null;
}

export const vikiWatchPlayback: WatchPlayback = {
  pageIdentity: vikiVideoId,
  mainVideo: episodeVideo,
  refreshEvents: ['popstate']
};
