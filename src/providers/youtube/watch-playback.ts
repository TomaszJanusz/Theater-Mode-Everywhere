import { YOUTUBE_PLAYER_SELECTOR } from '../navigation/youtube';
import { youtubeWatchPageId } from '../navigation/watch-page';
import { MINIPLAYER_SURFACE } from '../video-candidates';
import type { WatchPlayback } from '../watch-playback';

type WatchPlayer = HTMLElement & {
  getVideoData?: () => { video_id?: unknown };
  getPlayerResponse?: () => { videoDetails?: { videoId?: unknown } } | null;
};

/** Parked players sit inside the miniplayer only while `ytd-app` marks it active. */
const MINIPLAYER_PLAYER = `${MINIPLAYER_SURFACE} ${YOUTUBE_PLAYER_SELECTOR}`;

function singleMainVideo(player: HTMLElement): HTMLVideoElement | null {
  const videos = player.querySelectorAll<HTMLVideoElement>('video.html5-main-video');
  return videos.length === 1 ? videos[0] : null;
}

export const youtubeWatchPlayback: WatchPlayback = {
  pageIdentity: youtubeWatchPageId,
  // Navigation start and page-type change precede the reveal when entering a watch page from
  // Home, search or a channel; the later events alone start the countdown late.
  refreshEvents: ['yt-navigate-start', 'yt-page-type-changed', 'yt-page-data-updated', 'yt-player-updated'],
  mainVideo(doc, identity) {
    const player = doc.querySelector<WatchPlayer>(YOUTUBE_PLAYER_SELECTOR);
    const watch = player?.closest('ytd-watch-flexy');
    if (!player || !watch || watch.hasAttribute('hidden')) return null;
    // The same element plays prerolls. Content metadata alone is insufficient.
    if (player.matches('.ad-showing, .ad-interrupting')) return null;
    // getPlayerState() can still report buffering during the video's playing
    // event. The shared bridge checks the media's actual playback state.
    if (player.getVideoData?.().video_id !== identity) return null;
    return singleMainVideo(player);
  },
  preparingVideo(doc, identity) {
    // The watch page stays [hidden] and its player has no media or loaded video data until
    // YouTube finishes loading after an SPA entry. Only a different loaded video is stale.
    const player = doc.querySelector<WatchPlayer>(YOUTUBE_PLAYER_SELECTOR);
    if (!player?.closest('ytd-watch-flexy') || player.matches('.ad-showing, .ad-interrupting')) return null;
    const reported = player.getVideoData?.().video_id;
    if (reported !== undefined && reported !== '' && reported !== identity) return null;
    return singleMainVideo(player);
  },
  miniplayerVideo(doc) {
    const player = doc.querySelector<WatchPlayer>(MINIPLAYER_PLAYER);
    // An ad's ids are not the content's; the player API can also lag a new video for a moment.
    if (!player || player.matches('.ad-showing, .ad-interrupting')) return null;
    const identity = player.getVideoData?.().video_id;
    if (typeof identity !== 'string' || !/^[\w-]{11}$/.test(identity)
      || player.getPlayerResponse?.()?.videoDetails?.videoId !== identity) return null;
    const video = singleMainVideo(player);
    return video ? { video, identity } : null;
  },
  observe(video, onChange) {
    const player = video.ownerDocument.querySelector(YOUTUBE_PLAYER_SELECTOR);
    if (!player) return null;
    // Ads can finish without a second playing event on the reused video. The
    // player also flips classes such as ytp-autohide on every pointer move.
    const showingAd = () => player.matches('.ad-showing, .ad-interrupting');
    let adShown = showingAd();
    const observer = new MutationObserver(() => {
      if (showingAd() === adShown) return;
      adShown = !adShown;
      onChange();
    });
    observer.observe(player, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  },
  observeReveal(doc, onChange) {
    // Expanding the miniplayer fires yt-page-data-updated while the watch page is still
    // hidden; the host reveals it with attribute flips and moves the player out of the
    // miniplayer into the watch page only later (1-2 s on a slow page), with no event for
    // the already-playing video. That can outlast the entry countdown. The destination
    // depends on the layout (#player-container, #player-theater-container, full-bleed) and
    // the watch page itself may not exist yet, so watch a stable ancestor and react only to
    // the host revealing the page or the player arriving.
    const root = doc.querySelector('ytd-app') ?? doc.querySelector('ytd-watch-flexy');
    if (!root) return () => {};
    const observer = new MutationObserver(records => {
      if (records.some(revealsPlayer)) onChange();
    });
    observer.observe(root, { attributes: true, attributeFilter: ['hidden', 'miniplayer-is-active'], childList: true, subtree: true });
    return () => observer.disconnect();
  }
};

function revealsPlayer(record: MutationRecord): boolean {
  if (record.type === 'attributes') return record.target.nodeName === 'YTD-WATCH-FLEXY' || record.target.nodeName === 'YTD-APP';
  for (const node of record.addedNodes) {
    if (node instanceof Element && (node.matches(YOUTUBE_PLAYER_SELECTOR) || node.querySelector(YOUTUBE_PLAYER_SELECTOR))) return true;
  }
  return false;
}
