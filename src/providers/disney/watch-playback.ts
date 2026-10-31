import { disneyPlayId } from '../../media-features/parsers/disney-page';
import { isSwitchableTheaterVideo } from '../../switchable-videos';
import type { WatchPlayback } from '../watch-playback';

/**
 * How a video relates to Disney's player. `content` is the video Hive plays the title in; `dummy` is the hidden btm
 * media client video that is never the title; `candidate` is anything else, judged by size and source.
 */
export type DisneyVideoRole = 'content' | 'dummy' | 'candidate';

type VideoLike = Pick<HTMLVideoElement, 'className'>;

const hasClass = (video: VideoLike, name: string) =>
  typeof video.className === 'string' && new RegExp(`(?:^|\\s)${name}(?:\\s|$)`).test(video.className);

/**
 * The content video as Disney names it: `disney-web-player.mediaElement`, a page-world property (MAIN only). Disney
 * rewrites that video's classes whenever its player UI changes, replacing `hive-video` with
 * `btm-media-client-element` and styler classes, so classes alone cannot tell it from the dummy.
 */
export function disneyMediaElement(doc: Document = document): HTMLVideoElement | null {
  let element: unknown;
  try {
    element = (doc.querySelector('disney-web-player') as (Element & { mediaElement?: unknown }) | null)?.mediaElement;
  } catch {
    return null;
  }
  return typeof HTMLVideoElement !== 'undefined' && element instanceof HTMLVideoElement && element.isConnected ? element : null;
}

/** Without `mediaElement` (an older player, or a read that failed), the classes decide as they did before. */
export function disneyVideoRole(video: VideoLike, mediaElement: unknown): DisneyVideoRole {
  if (mediaElement && video === mediaElement) return 'content';
  if (hasClass(video, 'btm-media-client-element')) return 'dummy';
  return !mediaElement && hasClass(video, 'hive-video') ? 'content' : 'candidate';
}

const roleOf = (video: HTMLVideoElement) =>
  disneyVideoRole(video, typeof video.ownerDocument === 'object' && video.ownerDocument ? disneyMediaElement(video.ownerDocument) : null);

/** Whether `video` is the one Hive plays the title in. */
export function isDisneyContentVideo(video: HTMLVideoElement): boolean {
  return roleOf(video) === 'content';
}

/** The video Hive plays the title in, if the page has one. */
export function disneyContentVideo(doc: Document = document): HTMLVideoElement | null {
  const media = disneyMediaElement(doc);
  if (media) return media;
  const videos = doc.querySelector('disney-web-player')?.querySelectorAll<HTMLVideoElement>('video.hive-video') ?? [];
  return Array.from(videos).find(video => !hasClass(video, 'btm-media-client-element')) ?? null;
}

function hasTheaterVideoMark(video: HTMLVideoElement): boolean {
  try {
    return typeof video.hasAttribute === 'function' && video.hasAttribute('data-theater-everywhere');
  } catch {
    return false;
  }
}

/** A video that can hold the title: never the dummy, never hidden; the content video needs no box while it loads. */
export function isUsableDisneyMediaVideo(video: HTMLVideoElement | null | undefined, role: DisneyVideoRole = video ? roleOf(video) : 'dummy'): boolean {
  if (!video || role === 'dummy') return false;
  let display = '';
  try {
    display = video.style?.display || '';
  } catch {
    // Test doubles may omit style.
  }
  try {
    if (typeof getComputedStyle === 'function' && typeof (video as Node).nodeType === 'number') {
      display = getComputedStyle(video).display || display;
    }
  } catch {
    // Layout-less test doubles cannot compute styles.
  }
  if (display === 'none') return false;
  const videoWidth = Number(video.videoWidth) || 0;
  let boxW = Number(video.clientWidth) || 0;
  let boxH = Number(video.clientHeight) || 0;
  try {
    if (typeof video.getBoundingClientRect === 'function') {
      const rect = video.getBoundingClientRect();
      boxW = Math.max(boxW, rect.width || 0);
      boxH = Math.max(boxH, rect.height || 0);
    }
  } catch {
    // Ignore layout-less test doubles.
  }
  const hasBox = boxW > 8 && boxH > 8;
  const hasSource = Boolean(video.currentSrc || video.src);
  if (role === 'content' || hasClass(video, 'theater-everywhere-video-active') || hasTheaterVideoMark(video)) {
    return videoWidth > 0 || hasSource || hasBox;
  }
  return (videoWidth > 0 || hasSource) && hasBox;
}

export const disneyWatchPlayback: WatchPlayback = {
  pageIdentity(url) {
    // Locale prefixes are optional. Browse pages and legacy /video/ routes are
    // not automatically promoted to watch sessions by the broader media parser.
    const identity = disneyPlayId(url.href);
    const path = url.pathname.replace(/^\/[a-z]{2}(?:-[a-z]{2})?(?=\/)/i, '').replace(/\/$/, '');
    return identity && path.toLowerCase() === `/play/${identity}` ? identity : null;
  },
  mainVideo(doc, _identity, purpose) {
    const player = doc.querySelector('disney-web-player');
    if (!player) return null;
    // Disney names its content video; class names are the fallback for a player that does not.
    const media = disneyMediaElement(doc);
    const candidates = media && player.contains(media) ? [media] : Array.from(player.querySelectorAll<HTMLVideoElement>('video.hive-video'));
    const videos = candidates.filter(video => (purpose === 'replacement' || (!video.paused && !video.ended))
      && isUsableDisneyMediaVideo(video) && isSwitchableTheaterVideo(video));
    // The play route owns the session, including ads. Exclude Disney's separate
    // btm media client and reject ambiguous main players instead of guessing.
    return videos.length === 1 ? videos[0] : null;
  }
};
