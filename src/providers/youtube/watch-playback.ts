import { YOUTUBE_PLAYER_SELECTOR } from '../navigation/youtube';
import { youtubeWatchPageId } from '../navigation/watch-page';
import type { WatchPlayback } from '../watch-playback';

type WatchPlayer = HTMLElement & {
  getVideoData?: () => { video_id?: unknown };
};

export const youtubeWatchPlayback: WatchPlayback = {
  pageIdentity: youtubeWatchPageId,
  mainVideo(doc, identity) {
    const player = doc.querySelector<WatchPlayer>(YOUTUBE_PLAYER_SELECTOR);
    const watch = player?.closest('ytd-watch-flexy');
    if (!player || !watch || watch.hasAttribute('hidden')) return null;
    // The same element plays prerolls. Content metadata alone is insufficient.
    if (player.matches('.ad-showing, .ad-interrupting')) return null;
    // getPlayerState() can still report buffering during the video's playing
    // event. The shared bridge checks the media's actual playback state.
    if (player.getVideoData?.().video_id !== identity) return null;
    const videos = player.querySelectorAll<HTMLVideoElement>('video.html5-main-video');
    return videos.length === 1 ? videos[0] : null;
  },
  observe(video, onChange) {
    const player = video.closest(YOUTUBE_PLAYER_SELECTOR);
    if (!player) return () => {};
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
  }
};
