import { installQualityBridge } from '../video-quality-bridge';

type TwitchQuality = { group?: unknown; name?: unknown; height?: unknown };
type MediaPlayer = {
  getHTMLVideoElement?: () => unknown;
  getQualities?: () => unknown;
  getQuality?: () => TwitchQuality | null | undefined;
  isAutoQualityMode?: () => unknown;
  setQuality?: (quality: TwitchQuality) => unknown;
  setAutoQualityMode?: (auto: boolean) => unknown;
  getLoadedChannelLogin?: () => unknown;
};
type Fiber = { return?: Fiber | null; memoizedProps?: { mediaPlayerInstance?: unknown } | null };

/** How far up the tree the player component sits above the video's React host element (measured: 30). */
const MAX_FIBER_DEPTH = 60;
const players = new WeakMap<HTMLVideoElement, MediaPlayer>();

/** The player instance owns the element it plays into; anything else belongs to another player. */
const owns = (player: MediaPlayer, video: HTMLVideoElement) => player.getHTMLVideoElement?.() === video;

/**
 * Twitch's media player (the one behind Settings > Quality) is not exposed on the page: the video element is created by
 * the player core, and the nearest React host element above it (`.video-ref`) leads up the component tree to the
 * `mediaPlayerInstance` prop. Measured logged out (2026-11): `getQualities()` lists `{ group, name, height }`,
 * `isAutoQualityMode()` reports Auto, `setQuality(q)` fixes a level and `setAutoQualityMode(true)` hands it back.
 * The instance is kept per element only while it still plays into it.
 */
function player(video: HTMLVideoElement): MediaPlayer | null {
  const cached = players.get(video);
  if (cached && owns(cached, video)) return cached;
  let host: Element | null = video;
  let key: string | undefined;
  for (let hops = 0; host && hops < 4 && !key; hops += 1) {
    key = Object.keys(host).find(name => name.startsWith('__reactFiber'));
    if (!key) host = host.parentElement;
  }
  let fiber = key && host ? (host as unknown as Record<string, Fiber | undefined>)[key] : undefined;
  for (let depth = 0; fiber && depth < MAX_FIBER_DEPTH; depth += 1, fiber = fiber.return ?? undefined) {
    const candidate = fiber.memoizedProps?.mediaPlayerInstance as MediaPlayer | undefined;
    if (candidate && typeof candidate === 'object' && owns(candidate, video)) {
      players.set(video, candidate);
      return candidate;
    }
  }
  return null;
}

function qualities(instance: MediaPlayer): TwitchQuality[] {
  const list = instance.getQualities?.();
  return Array.isArray(list) ? list.filter((quality): quality is TwitchQuality => Boolean(quality) && typeof quality === 'object') : [];
}

/** The channel, and the recording when the page plays one: a new stream or VOD is another item. */
function mediaId(instance: MediaPlayer): string | null {
  const login = instance.getLoadedChannelLogin?.();
  if (typeof login !== 'string' || !login) return null;
  const vod = /^\/videos\/(\d+)/.exec(window.location.pathname)?.[1];
  return vod ? `${login}/videos/${vod}` : login;
}

function read(video: HTMLVideoElement): unknown {
  const instance = player(video);
  const id = instance && mediaId(instance);
  // Ads stitched into the stream replace the picture; a pick then changes nothing the viewer can judge.
  if (!instance || !id || video.closest('.video-player')?.querySelector('[data-a-target="video-ad-label"], [data-a-target="video-ad-countdown"]')) return null;
  const current = instance.getQuality?.()?.group;
  return {
    mediaId: id,
    levels: qualities(instance).map(quality => ({ id: quality.group, label: quality.name, height: quality.height })),
    fixed: instance.isAutoQualityMode?.() === true ? null : current,
    playing: current
  };
}

function select(video: HTMLVideoElement, level: string | null): boolean {
  const instance = player(video);
  if (!instance) return false;
  if (level === null) {
    instance.setAutoQualityMode?.(true);
    return instance.isAutoQualityMode?.() === true;
  }
  const quality = qualities(instance).find(candidate => candidate.group === level);
  if (!quality) return false;
  instance.setQuality?.(quality);
  return instance.isAutoQualityMode?.() !== true;
}

export function installTwitchQuality(): void {
  installQualityBridge('twitch', { read, select });
}
