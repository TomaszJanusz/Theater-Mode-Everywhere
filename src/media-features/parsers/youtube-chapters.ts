import type { Chapter } from '../types';

const TIMESTAMP_LINE_RE =
  /(?:^|\n)\s*(?:(?:\d+[\.)]\s*)|(?:[-*•]\s*))?((?:\d{1,2}:)?\d{1,2}:\d{2})\s+[-–—:]?\s*(.+?)\s*(?=\n|$)/g;

export function parseClockToSeconds(value: string): number | null {
  const parts = value.trim().split(':');
  if (parts.length < 2 || parts.length > 3) return null;
  const numbers = parts.map((part) => Number(part));
  if (numbers.some((n) => !Number.isFinite(n) || n < 0)) return null;
  if (parts.length === 2) {
    return numbers[0] * 60 + numbers[1];
  }
  return numbers[0] * 3600 + numbers[1] * 60 + numbers[2];
}

export function parseYoutubeDescriptionChapters(
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
  // YouTube's auto-chapter UI wants 3+ stamps; a 0:00 Contents pair is still a usable list.
  if (matches.length < 2) return [];
  if (matches[0].start !== 0) return [];

  const chapters: Chapter[] = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].start;
    const end = i + 1 < matches.length ? matches[i + 1].start : (Number.isFinite(duration) ? duration : undefined);
    if (end !== undefined && end - start < 10) return [];
    chapters.push({
      start,
      end,
      title: matches[i].title,
      source: 'youtube-description',
      confidence: 'high'
    });
  }

  return chapters;
}

export type YoutubeMarker = {
  startMillis?: number;
  title?: { simpleText?: string } | string;
  titleLabel?: { simpleText?: string };
};

export function parseYoutubeMarkerChapters(
  markers: YoutubeMarker[],
  duration = Number.POSITIVE_INFINITY
): Chapter[] {
  const parsed = markers
    .map((marker) => {
      const start = Number(marker.startMillis) / 1000;
      const titleValue = marker.titleLabel?.simpleText
        || (typeof marker.title === 'string' ? marker.title : marker.title?.simpleText)
        || '';
      return { start, title: titleValue.trim() };
    })
    .filter((item) => Number.isFinite(item.start) && item.start >= 0 && item.title)
    .sort((a, b) => a.start - b.start);

  if (parsed.length === 0) return [];

  return parsed.map((item, index) => {
    const next = parsed[index + 1];
    const end = next ? next.start : (Number.isFinite(duration) ? duration : undefined);
    return {
      start: item.start,
      end,
      title: item.title,
      source: 'youtube-markers',
      confidence: 'medium' as const
    };
  });
}
