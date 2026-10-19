import { twitchVodId } from '../navigation/watch-page';
import type { WatchPlayback } from '../watch-playback';
import { TWITCH_NAVIGATE_EVENT } from './navigation';

/**
 * The VOD page's only player video. Hover previews, the mini player and any second video fail
 * closed. A live stream reports an infinite duration, which also rejects the previous channel's
 * video during SPA entry from a channel page. Ads stitched into the VOD stream stay part of the
 * watch session, as on Netflix and Disney+.
 */
function singleVodVideo(doc: Document): HTMLVideoElement | null {
  const videos = doc.querySelectorAll<HTMLVideoElement>('[data-a-target="video-ref"] video');
  if (videos.length !== 1 || doc.querySelectorAll('video').length !== 1) return null;
  return videos[0].duration === Infinity ? null : videos[0];
}

export const twitchWatchPlayback: WatchPlayback = {
  pageIdentity: twitchVodId,
  // Identity is URL-only: the player exposes no cheap, synchronous VOD id to confirm against.
  mainVideo: singleVodVideo,
  preparingVideo: singleVodVideo,
  refreshEvents: [TWITCH_NAVIGATE_EVENT]
};
