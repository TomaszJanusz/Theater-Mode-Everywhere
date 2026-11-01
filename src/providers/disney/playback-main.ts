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
  setTimeout(callback: () => void, ms: number): number;
  clearTimeout(id: number): void;
};

/** How long Hive has to put the element in the requested state before the element is asked directly. */
export const DISNEY_SETTLE_MS = 250;

/**
 * Pause and play through Hive's own `mediaPlayer`, so the model Disney's bar and a media reload resume from agrees with the
 * element. Pausing only the `<video>` leaves Hive PLAYING, and an audio switch then resumes from its running position
 * (tens of seconds ahead after a long pause). Returns false whenever the element is the right actor: another title
 * or video, an ended title (Replay is the element's), a player without the method, or a throwing call.
 *
 * Hive's store is not trusted to decide: it can trail the element by a few hundred milliseconds, and a call to a model that
 * already shows the state is merely ignored. Instead Hive is always asked first and the element is checked after
 * `DISNEY_SETTLE_MS` (or at once on a refusal): if it is not in the requested state, the element is moved, which
 * also covers a Hive that ignored the call. Each request retires the previous one's check, and so do another title,
 * a replaced player and RTE off.
 */
export function createDisneyHostPlayback(env: DisneyPlaybackEnv): (action: 'play' | 'pause', video: HTMLVideoElement) => boolean {
  let latest = 0;
  let timer: number | null = null;
  return (action, video) => {
    try {
      if (!env.enabled() || video.ended || !video.isConnected) return false;
      const playId = disneyAudioPlayId(env.href());
      const web = env.web();
      if (!playId || !web || env.contentVideo() !== video) return false;
      const player = own(web, 'mediaPlayer') as HostPlayer | undefined;
      if (!isRecord(player) || typeof player[action] !== 'function') return false;
      if (timer !== null) env.clearTimeout(timer);
      timer = null;
      const request = ++latest;
      const settle = () => {
        if (request !== latest || !env.enabled() || disneyAudioPlayId(env.href()) !== playId || own(web, 'mediaPlayer') !== player
          || !video.isConnected || video.ended) return;
        if (action === 'pause' && !video.paused) video.pause();
        else if (action === 'play' && video.paused) void video.play().catch(() => {});
      };
      const result = player[action]!();
      if (isRecord(result) && typeof result.then === 'function') (result as unknown as Promise<unknown>).then(undefined, settle);
      timer = env.setTimeout(settle, DISNEY_SETTLE_MS);
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
  contentVideo: () => disneyContentVideo(),
  setTimeout: (callback, ms) => window.setTimeout(callback, ms),
  clearTimeout: id => window.clearTimeout(id)
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
