import { stripNetflixSiteTitle } from '../../media-features/parsers/netflix-page';
import { publishHiddenJson } from '../../platform/hidden-json';

export const NETFLIX_NEXT_PREVIEW_ID = 'theater-everywhere-netflix-next-preview';

type NextVideo = {
  getTitle?: () => unknown;
  getEpisodeTitle?: () => unknown;
  getEpisodeThumbnail?: () => { url?: unknown } | null;
  getLoadingImageUrl?: () => unknown;
  getNextEpisode?: () => unknown;
};

export type NetflixNextPreview = { title: string; imageUrl: string };

/** Show title and episode still for the metadata object's next episode. */
export function netflixNextEpisodePreview(currentVideo: unknown): NetflixNextPreview | null {
  const current = asVideo(currentVideo);
  let next: NextVideo | null = null;
  try {
    next = asVideo(current?.getNextEpisode?.());
  } catch {
    return null;
  }
  if (!next) return null;
  let show: string | null = null;
  let episode: string | null = null;
  let thumbnail: { url?: unknown } | null = null;
  let loading: unknown = null;
  try {
    show = stripNetflixSiteTitle(next.getTitle?.());
    episode = stripNetflixSiteTitle(next.getEpisodeTitle?.());
    thumbnail = next.getEpisodeThumbnail?.() ?? null;
    loading = next.getLoadingImageUrl?.();
  } catch {
    return null;
  }
  const title = show && episode && show !== episode ? `${show} · ${episode}` : episode || show;
  const imageUrl = httpsUrl(thumbnail && typeof thumbnail === 'object' ? thumbnail.url : null) || httpsUrl(loading);
  return acceptPreview(title, imageUrl);
}

export function syncNetflixNextPreview(videoId: string | null, currentVideo: unknown): void {
  if (videoId && !asVideo(currentVideo)) return;
  const available = videoId ? netflixHasNextEpisode(currentVideo) : false;
  const preview = available ? netflixNextEpisodePreview(currentVideo) : null;
  const payload = available ? { videoId, available: true, ...(preview ?? {}) } : null;
  const next = payload ? JSON.stringify(payload) : null;
  const existing = document.getElementById(NETFLIX_NEXT_PREVIEW_ID);
  if ((existing?.textContent ?? null) === next) return;
  if (next == null && !existing) return;
  publishHiddenJson(NETFLIX_NEXT_PREVIEW_ID, payload);
}

/** True when this watch id still has a next episode, even if the still is missing. */
export function readNetflixNextAvailable(doc: Document, videoId: string): boolean {
  const data = readNextPreviewPayload(doc);
  return data?.videoId === videoId && data.available === true;
}

/** Isolated-world read of the main-world snapshot. A mismatched watch id is ignored. */
export function readNetflixNextPreview(doc: Document, videoId: string): NetflixNextPreview | null {
  const data = readNextPreviewPayload(doc);
  if (!data || data.videoId !== videoId) return null;
  return acceptPreview(data.title, data.imageUrl);
}

function readNextPreviewPayload(doc: Document): { videoId?: unknown; available?: unknown; title?: unknown; imageUrl?: unknown } | null {
  const text = doc.getElementById(NETFLIX_NEXT_PREVIEW_ID)?.textContent;
  if (!text || text.length > 2400) return null;
  try {
    const data = JSON.parse(text) as { videoId?: unknown; available?: unknown; title?: unknown; imageUrl?: unknown };
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

function netflixHasNextEpisode(currentVideo: unknown): boolean {
  try {
    return asVideo(asVideo(currentVideo)?.getNextEpisode?.()) != null;
  } catch {
    return false;
  }
}

function asVideo(value: unknown): NextVideo | null {
  return value && typeof value === 'object' ? value as NextVideo : null;
}

function acceptPreview(title: unknown, imageUrl: unknown): NetflixNextPreview | null {
  const cleanTitle = typeof title === 'string' ? title.replace(/\s+/g, ' ').trim() : '';
  const url = httpsUrl(imageUrl);
  if (!cleanTitle || cleanTitle.length > 180 || !url) return null;
  return { title: cleanTitle, imageUrl: url };
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 2000) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}
