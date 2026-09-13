import type { YoutubePlayerSnapshot } from './probe';

export const YOUTUBE_SNAPSHOT_SCRIPT_ID = 'theater-everywhere-youtube-snapshot';
export const YOUTUBE_CAPTION_AUTH_ID = 'theater-everywhere-youtube-caption-auth';

export function readPublishedYoutubeSnapshot(
  root: Pick<ParentNode, 'querySelector'> = document
): YoutubePlayerSnapshot | null {
  const el = root.querySelector(`#${YOUTUBE_SNAPSHOT_SCRIPT_ID}`);
  const text = el?.textContent || '';
  if (!text) return null;
  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object') return null;
    return data as YoutubePlayerSnapshot;
  } catch {
    return null;
  }
}

export function readPublishedYoutubeCaptionAuthUrls(
  root: Pick<ParentNode, 'querySelector'> = document
): string[] {
  const el = root.querySelector(`#${YOUTUBE_CAPTION_AUTH_ID}`);
  const text = el?.textContent || '';
  if (!text) return [];
  try {
    const data = JSON.parse(text);
    if (!Array.isArray(data)) return [];
    return data.filter((item): item is string => typeof item === 'string' && item.length > 0);
  } catch {
    return [];
  }
}

export function firstMatchingYoutubeSnapshot(
  pageVideoId: string | null,
  candidates: Array<YoutubePlayerSnapshot | null | undefined>
): YoutubePlayerSnapshot | null {
  for (const snapshot of candidates) {
    if (!snapshot) continue;
    if (!snapshot.videoId || !pageVideoId || snapshot.videoId === pageVideoId) return snapshot;
  }
  return null;
}
