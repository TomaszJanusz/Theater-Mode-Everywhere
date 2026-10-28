import { sanitizeContentTitle } from '../content-title';
import type { Chapter } from '../types';

/** SOOP's own chapter list for a recording; the page requests it when the VOD opens. */
export function soopChaptersUrl(vodId: string): string | null {
  return /^\d{1,12}$/.test(vodId)
    ? `https://stbbs.sooplive.com/api/chapter/Controllers/ChapterListController.php?nTitleNo=${vodId}&szFileType=REVIEW`
    : null;
}

const MAX_CHAPTERS = 200;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/**
 * `data` lists one entry per broadcast-title change (`data_type: "TITLE_HISTORY"`), each with the
 * title and its start in seconds. Entries outside the recording, repeated starts and untitled
 * entries are dropped; a chapter ends where the next begins, the last at the recording's end.
 */
export function parseSoopChapters(body: string, duration: number): Chapter[] {
  let root: Record<string, unknown>;
  try { root = record(JSON.parse(body)); } catch { return []; }
  if (root.result !== 1 || !Array.isArray(root.data) || !Number.isFinite(duration) || duration <= 0) return [];
  const seen = new Set<number>();
  const entries = root.data.slice(0, MAX_CHAPTERS).flatMap((item) => {
    const entry = record(item);
    const title = sanitizeContentTitle(entry.title);
    const start = entry.time_sec;
    if (!title || typeof start !== 'number' || !Number.isFinite(start) || start < 0 || start >= duration || seen.has(start)) return [];
    seen.add(start);
    return [{ title, start }];
  }).sort((a, b) => a.start - b.start);
  return entries.map((entry, index) => ({
    start: entry.start,
    end: entries[index + 1]?.start ?? duration,
    title: entry.title,
    source: 'soop',
    confidence: 'high' as const
  }));
}
