import { disneyPlayId, isUsableDisneyMediaVideo } from '../../media-features/parsers/disney-page';
import { isSwitchableTheaterVideo } from '../../switchable-videos';
import type { WatchPlayback } from '../watch-playback';

export const disneyWatchPlayback: WatchPlayback = {
  pageIdentity(url) {
    // Locale prefixes are optional. Browse pages and legacy /video/ routes are
    // not automatically promoted to watch sessions by the broader media parser.
    const identity = disneyPlayId(url.href);
    const path = url.pathname.replace(/^\/[a-z]{2}(?:-[a-z]{2})?(?=\/)/i, '').replace(/\/$/, '');
    return identity && path.toLowerCase() === `/play/${identity}` ? identity : null;
  },
  mainVideo(doc) {
    const player = doc.querySelector('disney-web-player');
    if (!player) return null;
    const videos = Array.from(player.querySelectorAll<HTMLVideoElement>('video.hive-video'))
      .filter(video => !video.paused && !video.ended
        && isUsableDisneyMediaVideo(video) && isSwitchableTheaterVideo(video));
    // The play route owns the session, including ads. Exclude Disney's separate
    // btm media client and reject ambiguous main players instead of guessing.
    return videos.length === 1 ? videos[0] : null;
  }
};
