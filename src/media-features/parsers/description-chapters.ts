import type { Chapter } from '../types';

const TIMESTAMP_LINE_RE =
  /(?:^|\n)\s*(?:(?:\d+[\.)]\s*)|(?:[-*•]\s*))?((?:\d{1,2}:)?\d{1,2}:\d{2})\s+[-–—:]?\s*(.+?)\s*(?=\n|$)/g;
/** A clock time ending a line: `Title - 0:00`, which YouTube also turns into chapters. */
const TIME_AT_END_RE = /(?:\d{1,2}:)?\d{1,2}:\d{2}$/;
const TITLE_SEPARATORS = new Set(['-', '–', '—', ':', '|']);
const LETTER_RE = /\p{L}/u;

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
  // One form per description: a line listing a time after its title is read only when no line leads with one.
  const leading = chaptersFromStamps(leadingStamps(description), duration);
  return leading.length > 0 ? leading : chaptersFromStamps(trailingStamps(description), duration);
}

/** Lines ending in a time after a title holding a letter, so a bare `1:00:00` line is no chapter titled `1`. */
function trailingStamps(description: string): Stamp[] {
  const stamps: Stamp[] = [];
  for (const raw of description.split('\n')) {
    const line = raw.trim();
    const time = TIME_AT_END_RE.exec(line);
    // A digit or colon before the match means the line's time is longer than the pattern, such as `100:00`.
    if (!time || /[\d:]/.test(line.charAt(time.index - 1))) continue;
    const title = trimTitle(line.slice(0, time.index));
    const start = parseClockToSeconds(time[0]);
    if (start !== null && LETTER_RE.test(title)) stamps.push({ start, title });
  }
  return stamps;
}

/** Drops a leading list bullet and the separators between the title and its time. */
function trimTitle(text: string): string {
  let end = text.length;
  while (end > 0 && (TITLE_SEPARATORS.has(text[end - 1]) || text[end - 1].trim() === '')) end--;
  const bullet = '-*•'.includes(text.charAt(0)) && text.length > 1 ? 1 : 0;
  return text.slice(bullet, end).replace(/\s+/g, ' ').trim();
}

type Stamp = { start: number; title: string };

function leadingStamps(description: string): Stamp[] {
  const stamps: Stamp[] = [];
  for (const match of description.matchAll(TIMESTAMP_LINE_RE)) {
    const start = parseClockToSeconds(match[1]);
    const title = (match[2] || '').replace(/\s+/g, ' ').trim();
    if (start !== null && title) stamps.push({ start, title });
  }
  return stamps;
}

function chaptersFromStamps(stamps: Stamp[], duration: number): Chapter[] {
  const matches: Stamp[] = [];
  const seen = new Set<number>();
  for (const { start, title } of stamps) {
    if (seen.has(start)) continue;
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
