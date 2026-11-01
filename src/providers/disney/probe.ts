import { isSafeDisneyBifUrl, isSafeDisneyMasterUrl, type DisneyThumbnailMeta } from './page';

/** What the adapter reads from MAIN's snapshot probe (`readDisneySnapshot`). */
export type DisneyProbe = {
  mediaId?: string;
  duration?: number;
  masterUrl?: string;
  storyboardUrl?: string;
  thumbnail?: DisneyThumbnailMeta;
};

const PLAY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;

function parseThumbnail(value: unknown): DisneyThumbnailMeta | undefined {
  if (!record(value) || !positive(value.width) || !positive(value.height) || !positive(value.intervalMs)) return undefined;
  const bifUrl = typeof value.bifUrl === 'string' && isSafeDisneyBifUrl(value.bifUrl) ? value.bifUrl : undefined;
  return { width: value.width, height: value.height, intervalMs: value.intervalMs, ...(bifUrl ? { bifUrl } : {}) };
}

/** Page scripts can answer the probe too: keep only well-formed fields and media URLs the provider would fetch. */
export function parseDisneyProbe(value: unknown): DisneyProbe | null {
  if (!record(value)) return null;
  const mediaId = typeof value.mediaId === 'string' && PLAY_ID.test(value.mediaId) ? value.mediaId.toLowerCase() : undefined;
  const duration = positive(value.duration) ? value.duration : undefined;
  const masterUrl = typeof value.masterUrl === 'string' && isSafeDisneyMasterUrl(value.masterUrl) ? value.masterUrl : undefined;
  const storyboardUrl = typeof value.storyboardUrl === 'string' && isSafeDisneyBifUrl(value.storyboardUrl) ? value.storyboardUrl : undefined;
  const thumbnail = parseThumbnail(value.thumbnail);
  return { mediaId, duration, masterUrl, storyboardUrl, thumbnail };
}
