import { heightFromLabel, installQualityBridge } from '../video-quality-bridge';

type QualityPlayer = HTMLElement & {
  getVideoData?: () => { video_id?: unknown } | null | undefined;
  getAvailableQualityData?: () => unknown;
  getPreferredQuality?: () => unknown;
  getPlaybackQuality?: () => unknown;
  setPlaybackQualityRange?: (min: string, max: string) => unknown;
  addEventListener(type: string, listener: () => void): void;
};

/** Heights of the player's quality keys, for labels that do not start with one. */
const KEY_HEIGHTS: Record<string, number> = {
  highres: 4320, hd2880: 2880, hd2160: 2160, hd1440: 1440, hd1080: 1080, hd720: 720, large: 480, medium: 360, small: 240, tiny: 144
};
/** Events the player emits when its levels, its quality or its ad state may have changed. */
const PLAYER_EVENTS = ['onPlaybackQualityChange', 'videodatachange', 'onStateChange'];
const listened = new WeakSet<Element>();
let changed: (() => void) | null = null;

/**
 * The watch, miniplayer or embed player that owns `video`. Its API is the one behind Settings > Quality: measured
 * logged out (player of 2026-11), `getAvailableQualityData()` lists `{ quality, qualityLabel, isPlayable }` highest
 * first, `getPreferredQuality()` is `auto` until a level is fixed, and `setPlaybackQualityRange(q, q)` fixes one
 * (YouTube remembers it in its own `yt-player-quality`, as for a pick in its menu). Premium-only levels are listed
 * with `isPlayable: false` and left out.
 */
function player(video: HTMLVideoElement): QualityPlayer | null {
  const element = video.closest<QualityPlayer>('.html5-video-player');
  return element && typeof element.getAvailableQualityData === 'function' && typeof element.setPlaybackQualityRange === 'function' ? element : null;
}

function listen(element: QualityPlayer): void {
  if (listened.has(element)) return;
  listened.add(element);
  for (const type of PLAYER_EVENTS) {
    try { element.addEventListener(type, () => changed?.()); } catch { /* An older player lacks the event. */ }
  }
}

function read(video: HTMLVideoElement): unknown {
  const element = player(video);
  const videoId = element?.getVideoData?.()?.video_id;
  // Ads play in the same player and list their own levels; a pick during one would not reach the content.
  if (!element || typeof videoId !== 'string' || element.matches('.ad-showing, .ad-interrupting')) return null;
  listen(element);
  const data = element.getAvailableQualityData?.();
  const levels = (Array.isArray(data) ? data : []).flatMap((entry: unknown) => {
    if (!entry || typeof entry !== 'object') return [];
    const { quality, qualityLabel, isPlayable } = entry as Record<string, unknown>;
    if (typeof quality !== 'string' || quality === 'auto' || isPlayable === false) return [];
    const label = typeof qualityLabel === 'string' ? qualityLabel : '';
    const height = heightFromLabel(label) ?? KEY_HEIGHTS[quality];
    return height ? [{ id: quality, label: label || `${height}p`, height }] : [];
  });
  const preferred = element.getPreferredQuality?.();
  return {
    mediaId: videoId,
    levels,
    fixed: preferred === 'auto' ? null : preferred,
    playing: element.getPlaybackQuality?.()
  };
}

function select(video: HTMLVideoElement, level: string | null): boolean {
  const element = player(video);
  if (!element) return false;
  const quality = level ?? 'auto';
  element.setPlaybackQualityRange?.(quality, quality);
  return typeof element.getPreferredQuality !== 'function' || element.getPreferredQuality() === quality;
}

export function installYouTubeQuality(): void {
  installQualityBridge('youtube', { read, select, observe: (onChange) => { changed = onChange; } });
}
