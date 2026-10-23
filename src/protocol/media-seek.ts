/**
 * Isolated -> MAIN request to seek a host-owned player. Firefox hides objects created in
 * the content-script compartment from page code (`Permission denied to access property`),
 * so `detail` crosses worlds as a JSON string and MAIN validates it on receipt.
 */
export const MEDIA_SEEK_EVENT = 'theater-everywhere-media-seek';

export type MediaSeekDetail = {
  live?: boolean;
  time?: number;
  resumeAfterSeek?: boolean;
  cancelPendingResume?: boolean;
};

const MAX_SEEK_DETAIL_CHARS = 200;

export function encodeMediaSeekDetail(detail: MediaSeekDetail): string {
  return JSON.stringify(detail);
}

/** Returns a request that asks for something (live head, a finite time or a resume cancel), else null. */
export function parseMediaSeekDetail(raw: unknown): MediaSeekDetail | null {
  if (typeof raw !== 'string' || raw.length > MAX_SEEK_DETAIL_CHARS) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  const detail: MediaSeekDetail = {};
  for (const key of ['live', 'resumeAfterSeek', 'cancelPendingResume'] as const) {
    const value = record[key];
    if (value === undefined) continue;
    if (typeof value !== 'boolean') return null;
    detail[key] = value;
  }
  if (record.time !== undefined) {
    if (typeof record.time !== 'number' || !Number.isFinite(record.time)) return null;
    detail.time = record.time;
  }
  return detail.live === true || detail.cancelPendingResume === true || detail.time !== undefined ? detail : null;
}
