import { netflixVideoId, stripNetflixSiteTitle, type NetflixCaptionApi } from '../../media-features/parsers/netflix-page';

export type NetflixSessionPlayer = NetflixCaptionApi & {
  getMovieId?: () => unknown;
  getElement?: () => unknown;
  isReady?: () => boolean;
  isPaused?: () => boolean;
  getDuration?: () => number;
  getCurrentTime?: () => number;
  getTimeCodes?: () => Array<{ type?: string; startOffsetMs?: number; endOffsetMs?: number }>;
  play?: () => unknown;
  pause?: () => unknown;
  playNextEpisode?: () => unknown;
  seek?: (milliseconds: number) => unknown;
  getTrickPlayFrame?: (milliseconds: number) => unknown;
};

type VideoMetadata = {
  getTitle?: () => unknown;
  getCurrentVideo?: () => { getEpisodeTitle?: () => unknown; getNextEpisode?: () => unknown };
};

export type NetflixPlayerAppApi = {
  videoPlayer?: {
    getAllPlayerSessionIds?: () => string[];
    getVideoPlayerBySessionId?: (id: string) => NetflixSessionPlayer | null;
  };
  getVideoMetadataByVideoId?: (id: number) => VideoMetadata | null;
};

export function netflixWatchId(pathname: string): string | null {
  return netflixVideoId(pathname.match(/^\/watch\/(\d+)(?:\/|$)/)?.[1]);
}

/** Select the session attached to this player, never a background/seamless episode. */
export function selectNetflixSession(api: NetflixPlayerAppApi | null, root: HTMLElement | null, watchId: string | null): NetflixSessionPlayer | null {
  if (!api?.videoPlayer || !root) return null;
  const expected = watchId || netflixVideoId(root.getAttribute('data-videoid'));
  try {
    for (const id of (api.videoPlayer.getAllPlayerSessionIds?.() || []).slice(0, 16)) {
      const player = api.videoPlayer.getVideoPlayerBySessionId?.(id);
      if (!player || !netflixVideoId(player.getMovieId?.())) continue;
      if (expected && netflixVideoId(player.getMovieId?.()) !== expected) continue;
      const element = player.getElement?.();
      if (!(element instanceof Element) || !element.isConnected || !root.contains(element)) continue;
      return player;
    }
  } catch { /* A loading/closed session is not usable. */ }
  return null;
}

export function readNetflixPlayerAppApi(): NetflixPlayerAppApi | null {
  try {
    const target = window as Window & { netflix?: { appContext?: { state?: { playerApp?: { getAPI?: () => NetflixPlayerAppApi } } } } };
    return target.netflix?.appContext?.state?.playerApp?.getAPI?.() || null;
  } catch { return null; }
}

export function netflixSessionTitle(api: NetflixPlayerAppApi | null, videoId: string | null): string | null {
  if (!api || !videoId) return null;
  try {
    const metadata = api.getVideoMetadataByVideoId?.(Number(videoId));
    const title = stripNetflixSiteTitle(metadata?.getTitle?.());
    const episode = stripNetflixSiteTitle(metadata?.getCurrentVideo?.()?.getEpisodeTitle?.());
    return title && episode && title !== episode ? `${title} · ${episode}` : title || episode;
  } catch { return null; }
}

/** Advance only when this session is the watch id and metadata still has a next episode. */
export function playNetflixNextEpisode(api: NetflixPlayerAppApi | null, player: NetflixSessionPlayer | null, videoId: string): boolean {
  if (!player || netflixVideoId(player.getMovieId?.()) !== videoId || typeof player.playNextEpisode !== 'function') return false;
  let next: unknown = null;
  try {
    next = api?.getVideoMetadataByVideoId?.(Number(videoId))?.getCurrentVideo?.()?.getNextEpisode?.();
  } catch {
    return false;
  }
  if (!next) return false;
  try {
    player.playNextEpisode();
    return true;
  } catch {
    return false;
  }
}

export function seekNetflixSession(player: NetflixSessionPlayer, time: number, resume: boolean): boolean {
  if (!Number.isFinite(time) || time < 0 || typeof player.seek !== 'function') return false;
  try {
    const duration = player.getDuration?.();
    const ms = Math.round(time * 1000);
    player.seek(Number.isFinite(duration) && duration! > 0 ? Math.min(ms, duration!) : ms);
    // Netflix seek keeps its playback intent. Explicitly restore the user's intent
    // through a buffering seek, including repeated keyboard jumps.
    if (resume) player.play?.();
    else player.pause?.();
    return true;
  } catch { return false; }
}
