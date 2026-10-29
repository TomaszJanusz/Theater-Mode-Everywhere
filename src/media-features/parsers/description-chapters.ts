import type { Chapter } from '../types';

const TIMESTAMP_LINE_RE =
  /(?:^|\n)\s*(?:(?:\d+[\.)]\s*)|(?:[-*•]\s*))?((?:\d{1,2}:)?\d{1,2}:\d{2})\s+[-–—:]?\s*(.+?)\s*(?=\n|$)/g;

function parseClockToSeconds(value: string): number | null {
  const parts = value.trim().split(':');
  if (parts.length < 2 || parts.length > 3) return null;
  const numbers = parts.map((part) => Number(part));
  if (numbers.some((n) => !Number.isFinite(n) || n < 0)) return null;
  if (parts.length === 2) {
    return numbers[0] * 60 + numbers[1];
  }
  return numbers[0] * 3600 + numbers[1] * 60 + numbers[2];
}

export function parseDescriptionChapters(
  description: string,
  duration = Number.POSITIVE_INFINITY
): Chapter[] {
  const matches: Array<{ start: number; title: string }> = [];
  const seen = new Set<number>();

  for (const match of description.matchAll(TIMESTAMP_LINE_RE)) {
    const start = parseClockToSeconds(match[1]);
    const title = (match[2] || '').replace(/\s+/g, ' ').trim();
    if (start === null || !title || seen.has(start)) continue;
    if (Number.isFinite(duration) && start >= duration) continue;
    seen.add(start);
    matches.push({ start, title });
  }

  matches.sort((a, b) => a.start - b.start);
  // YouTube's chapter list starts at 0:00 and needs at least two stamps.
  // A segment shorter than 10s still appears on the watch page, so keep it.
  if (matches.length < 2) return [];
  if (matches[0].start !== 0) return [];

  const chapters: Chapter[] = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].start;
    const end = i + 1 < matches.length ? matches[i + 1].start : (Number.isFinite(duration) ? duration : undefined);
    if (end !== undefined && end <= start) continue;
    chapters.push({
      start,
      end,
      title: matches[i].title,
      source: 'youtube-description',
      confidence: 'high'
    });
  }

  return chapters.length >= 2 ? chapters : [];
}
