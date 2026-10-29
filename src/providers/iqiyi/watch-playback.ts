import { IQIYI_PLAYER_SELECTOR, selectedIqiyiEpisode } from './dom';
import { IQIYI_NAVIGATE_EVENT } from './snapshot';
import type { WatchPlayback } from '../watch-playback';

import { iqiyiPlayId } from './page';

/**
 * The episode's own player video: a direct child of the one `iqp-player`. Ad videos live in the
 * player's ad container, never beside it. While the host's highlighted episode still differs from
 * the URL's, the page is mid-navigation and nothing qualifies.
 */
function contentVideo(doc: Document, identity: string): HTMLVideoElement | null {
  const players = doc.querySelectorAll(IQIYI_PLAYER_SELECTOR);
  if (players.length !== 1) return null;
  const videos = players[0].querySelectorAll(':scope > video');
  const video = videos.length === 1 ? videos[0] : null;
  if (!(video instanceof HTMLVideoElement) || video.duration === Infinity) return null;
  const selected = selectedIqiyiEpisode(doc)?.querySelector('a[href]')?.getAttribute('href');
  if (selected && iqiyiPlayId(new URL(selected, doc.baseURI).pathname) !== identity) return null;
  return video;
}

export const iqiyiWatchPlayback: WatchPlayback = {
  pageIdentity: (url) => url.protocol === 'https:' && url.hostname === 'www.iq.com' ? iqiyiPlayId(url.pathname) : null,
  mainVideo: contentVideo,
  // The same test already tolerates a hidden or unsized video; the bridge adds the sized, sourced check.
  preparingVideo: contentVideo,
  refreshEvents: [IQIYI_NAVIGATE_EVENT]
};
