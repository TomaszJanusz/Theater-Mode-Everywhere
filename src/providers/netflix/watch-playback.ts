import { isSwitchableTheaterVideo } from '../../switchable-videos';
import type { WatchPlayback } from '../watch-playback';
import { findNetflixPlayerRoot, netflixWatchId, readNetflixPlayerAppApi, selectNetflixSession } from './session';

export const netflixWatchPlayback: WatchPlayback = {
  pageIdentity(url) {
    return /^\/watch\/\d+\/?$/.test(url.pathname) ? netflixWatchId(url.pathname) : null;
  },
  mainVideo(doc, identity) {
    const root = findNetflixPlayerRoot(doc);
    if (!root?.closest('.watch-video')) return null;
    const labeledId = root.getAttribute('data-videoid');
    if (labeledId && labeledId !== identity) return null;
    // URL + watch player suffice before native APIs mount. If the API is
    // available, it must confirm this session, never a preloaded next episode.
    const api = readNetflixPlayerAppApi();
    if (api?.videoPlayer && !selectNetflixSession(api, root, identity)) return null;
    const videos = Array.from(root.querySelectorAll<HTMLVideoElement>('video'))
      .filter(video => !video.paused && !video.ended && isSwitchableTheaterVideo(video));
    // Ads in this player belong to the watch session; catalog previews do not.
    return videos.length === 1 ? videos[0] : null;
  }
};
