import type { PreviewFrame } from '../types';
import { netflixVideoId } from './netflix-page';

export const NETFLIX_PREVIEW_EVENT = 'theater-everywhere-netflix-preview';
export const NETFLIX_PREVIEW_ID = 'theater-everywhere-netflix-preview-frame';
export const MAX_NETFLIX_PREVIEW_BYTES = 128 * 1024;

export function parseNetflixPreviewRequest(detail: unknown): { videoId: string; time: number } | null {
  if (typeof detail !== 'string' || detail.length > 100) return null;
  try {
    const value = JSON.parse(detail);
    const videoId = netflixVideoId(value?.videoId);
    return videoId && typeof value.time === 'number' && Number.isFinite(value.time) && value.time >= 0
      ? { videoId, time: value.time } : null;
  } catch { return null; }
}

export function parseNetflixPreviewFrame(text: string | null | undefined, videoId: string, time: number): PreviewFrame | null {
  if (!text || text.length > MAX_NETFLIX_PREVIEW_BYTES * 1.4 + 500) return null;
  try {
    const data = JSON.parse(text);
    if (data.videoId !== videoId || data.requestTime !== time) return null;
    if (!Number.isFinite(data.time) || data.time < 0 || Math.abs(data.time - time) > 30) return null;
    if (![data.width, data.height].every(value => Number.isInteger(value) && value > 0 && value <= 1024)) return null;
    if (typeof data.url !== 'string' || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(data.url)) return null;
    return {
      time: data.time, width: data.width, height: data.height,
      image: { kind: 'sprite', url: data.url, x: 0, y: 0, tileWidth: data.width, tileHeight: data.height, sheetWidth: data.width, sheetHeight: data.height }
    };
  } catch { return null; }
}
