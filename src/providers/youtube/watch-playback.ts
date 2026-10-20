import { YOUTUBE_PLAYER_SELECTOR } from '../navigation/youtube';
import { youtubeWatchPageId } from '../navigation/watch-page';
import type { WatchPlayback } from '../watch-playback';

type WatchPlayer = HTMLElement & {
  getVideoData?: () => { video_id?: unknown };
};

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
    // hidden; the host reveals it and takes the player out of the miniplayer a moment later
    // with attribute flips only. On a slow page that can outlast the entry countdown.
    const observer = new MutationObserver(onChange);
    const watch = doc.querySelector('ytd-watch-flexy');
    if (watch) observer.observe(watch, { attributes: true, attributeFilter: ['hidden'] });
    const app = doc.querySelector('ytd-app');
    if (app) observer.observe(app, { attributes: true, attributeFilter: ['miniplayer-is-active'] });
    return () => observer.disconnect();
  }
};
