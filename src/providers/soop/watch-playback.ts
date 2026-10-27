import { SOOP_PLAYER_SELECTOR, soopRoute, soopRouteKey } from '../soop-dom';
import { SOOP_NAVIGATE_EVENT } from '../soop-main';
import type { WatchPlayback } from '../watch-playback';

const VIDEO = { live: 'video#livePlayer', vod: 'video#video' } as const;

/**
 * The page's own stream video. Until the player terms are accepted the live element holds a
 * 0.1 s placeholder (a `data:` source), and the ad element is a separate `video#adVideo`, so only a
 * streamed `blob:` source qualifies. A live stream has an infinite duration, a recording a finite one.
 */
function contentVideo(doc: Document, identity: string): HTMLVideoElement | null {
  const kind = identity.split(':', 1)[0];
  const route = soopRoute(new URL(doc.defaultView?.location.href ?? doc.location.href));
  if (!route || route.kind !== kind || soopRouteKey(route) !== identity) return null;
  const videos = doc.querySelectorAll(`${SOOP_PLAYER_SELECTOR} ${VIDEO[route.kind]}`);
  const video = videos.length === 1 ? videos[0] : null;
  if (!(video instanceof HTMLVideoElement) || !video.currentSrc.startsWith('blob:')) return null;
  return (route.kind === 'live') === (video.duration === Infinity) ? video : null;
}

export const soopWatchPlayback: WatchPlayback = {
  pageIdentity(url) {
    const route = soopRoute(url);
    return route ? soopRouteKey(route) : null;
  },
  mainVideo: contentVideo,
  preparingVideo: contentVideo,
  refreshEvents: [SOOP_NAVIGATE_EVENT]
};
