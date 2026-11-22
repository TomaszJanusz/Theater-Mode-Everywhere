export type TwitchQuality = { group?: unknown; name?: unknown; height?: unknown };

/**
 * The part of Twitch's media player (Amazon IVS) this provider uses; every method may be missing. Measured
 * logged out (2026-11): `getQualities()` lists `{ group, name, height }`, `isAutoQualityMode()` reports Auto,
 * `setQuality(q)` fixes a level and `setAutoQualityMode(true)` hands it back (Settings > Quality).
 */
export type TwitchMediaPlayer = {
  getHTMLVideoElement?: () => unknown;
  getLoadedChannelLogin?: () => unknown;
  getPath?: () => unknown;
  getSessionData?: () => unknown;
  getState?: () => unknown;
  getQualities?: () => unknown;
  getQuality?: () => TwitchQuality | null | undefined;
  isAutoQualityMode?: () => unknown;
  setQuality?: (quality: TwitchQuality) => unknown;
  setAutoQualityMode?: (auto: boolean) => unknown;
};
type Fiber = { return?: Fiber | null; memoizedProps?: { mediaPlayerInstance?: unknown } | null };

/** How far up the tree the player component sits above the video's React host element (measured: 30). */
const MAX_FIBER_DEPTH = 60;
const players = new WeakMap<HTMLVideoElement, TwitchMediaPlayer>();

/** The player instance owns the element it plays into; anything else belongs to another player. */
const owns = (player: TwitchMediaPlayer, video: HTMLVideoElement) => player.getHTMLVideoElement?.() === video;

/**
 * MAIN world only. Twitch does not expose its media player on the page: the player core creates the
 * video, and the nearest React host element above it (`.video-ref`) leads up the component tree to the
 * `mediaPlayerInstance` prop. The instance is cached per element only while it still plays into it, so
 * frequent callers pay for the walk once per element.
 */
export function twitchMediaPlayer(video: HTMLVideoElement): TwitchMediaPlayer | null {
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
    const candidate = fiber.memoizedProps?.mediaPlayerInstance as TwitchMediaPlayer | undefined;
    if (candidate && typeof candidate === 'object' && owns(candidate, video)) {
      players.set(video, candidate);
      return candidate;
    }
  }
  return null;
}

/** The lowercased channel whose live stream the player loaded; VODs and clips report none. */
export function twitchLoadedChannel(player: TwitchMediaPlayer): string | null {
  const login = player.getLoadedChannelLogin?.();
  return typeof login === 'string' && login ? login.toLowerCase() : null;
}

/**
 * The past broadcast the player loaded, from the playlist it plays (measured logged out, 2026-11:
 * `https://usher.ttvnw.net/vod/v2/<id>.m3u8?…`; a live channel's is `…/api/v2/channel/hls/<login>.m3u8`).
 * The player names no channel for a VOD, so this is what tells one recording from the next.
 */
export function twitchLoadedVideo(player: TwitchMediaPlayer): string | null {
  const path = player.getPath?.();
  return typeof path === 'string' ? /^https:\/\/usher\.ttvnw\.net\/vod\/(?:v\d+\/)?(\d{1,20})\.m3u8(?:\?|$)/.exec(path)?.[1] ?? null : null;
}

/**
 * The broadcast the player is playing, from the live manifest's session data (`BROADCAST-ID`), only
 * while it reports Playing: around a channel switch the session data can still be the previous stream's.
 */
export function twitchPlayingBroadcast(player: TwitchMediaPlayer): string | null {
  if (player.getState?.() !== 'Playing') return null;
  const session = player.getSessionData?.();
  const id = session && typeof session === 'object' ? (session as Record<string, unknown>)['BROADCAST-ID'] : undefined;
  return typeof id === 'string' && /^\d{1,20}$/.test(id) ? id : null;
}

/** Twitch marks ads it stitches into a stream or VOD in the player overlay; the ad plays in the same element. */
export function twitchShowsAd(video: HTMLVideoElement): boolean {
  return Boolean(video.closest('.video-player')?.querySelector('[data-a-target="video-ad-label"], [data-a-target="video-ad-countdown"]'));
}
