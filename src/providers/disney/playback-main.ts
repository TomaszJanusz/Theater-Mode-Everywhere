import { mediaProviderIntegrationEnabled } from '../../media-features/provider-flags';

import { disneyAudioPlayId } from './audio-bridge';
import { isRecord, own } from './audio-main';
import { DISNEY_PLAYBACK_REQUEST, isDisneyPlaybackAction } from './playback-bridge';
import { disneyContentVideo } from './watch-playback';

type HostPlayer = { play?: () => unknown; pause?: () => unknown };

export type DisneyPlaybackEnv = {
  enabled(): boolean;
  href(): string;
  /** `disney-web-player` while it is connected. */
  web(): object | null;
  /** The video Hive plays the title in. */
  contentVideo(): HTMLVideoElement | null;
};

/** `state.player.extensions.playback.isPaused`, the model Disney's own bar draws; null when the store does not say. */
function hiveIsPaused(web: object): boolean | null {
  try {
    const store = own(web, 'stateStore');
    const state = isRecord(store) && typeof store.getState === 'function' ? (store.getState as () => unknown)() : null;
    const playback = isRecord(state) && isRecord(state.player) && isRecord(state.player.extensions) ? state.player.extensions.playback : null;
    return isRecord(playback) && typeof playback.isPaused === 'boolean' ? playback.isPaused : null;
  } catch {
    return null;
  }
}

/**
 * Pause and play through Hive's own `mediaPlayer`, so the model Disney's bar and a media reload resume from agrees with the
 * element. Pausing only the `<video>` leaves Hive PLAYING, and an audio switch then resumes from its running position
 * (tens of seconds ahead after a long pause). Returns false whenever the element is the right actor: another title
 * or video, an ended title (Replay is the element's), a player without the method, a throwing call, or a Hive model
 * that already shows the requested state (it would ignore the call and leave the element behind it).
 */
export function createDisneyHostPlayback(env: DisneyPlaybackEnv): (action: 'play' | 'pause', video: HTMLVideoElement) => boolean {
  let latest = 0;
  return (action, video) => {
    try {
      if (!env.enabled() || video.ended || !video.isConnected) return false;
      const playId = disneyAudioPlayId(env.href());
      const web = env.web();
      if (!playId || !web || env.contentVideo() !== video) return false;
      const player = own(web, 'mediaPlayer') as HostPlayer | undefined;
      if (!isRecord(player) || typeof player[action] !== 'function') return false;
      if (hiveIsPaused(web) === (action === 'pause')) return false;
      const request = ++latest;
      const result = player[action]!();
      // A refusal that arrives later falls back to the element, unless a newer request, another title or player has taken over.
      if (isRecord(result) && typeof result.then === 'function') {
        (result as unknown as Promise<unknown>).then(undefined, () => {
          if (request !== latest || !env.enabled() || disneyAudioPlayId(env.href()) !== playId || own(web, 'mediaPlayer') !== player || !video.isConnected) return;
          if (action === 'pause') video.pause();
          else void video.play().catch(() => {});
        });
      }
      return true;
    } catch {
      return false;
    }
  };
}

export const disneyHostPlayback = createDisneyHostPlayback({
  enabled: () => mediaProviderIntegrationEnabled('disney'),
  href: () => window.location.href,
  web: () => {
    const web = document.querySelector('disney-web-player');
    return web?.isConnected ? web : null;
  },
  contentVideo: () => disneyContentVideo()
});

/** What the theater marks on the video it plays; the isolated request names no video, so MAIN checks this one. */
const THEATER_VIDEO = '.theater-everywhere-video-active, [data-theater-everywhere]';

/** The isolated half's request (see `playback-bridge.ts`): cancelled once Hive was asked, so the caller leaves the element alone. */
export function installDisneyPlayback(): void {
  window.addEventListener(DISNEY_PLAYBACK_REQUEST, event => {
    const action = (event as CustomEvent<unknown>).detail;
    const video = disneyContentVideo();
    if (isDisneyPlaybackAction(action) && video?.matches(THEATER_VIDEO) && disneyHostPlayback(action, video)) event.preventDefault();
  });
}
