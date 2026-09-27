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

const MAX_CHAPTERS = 80;
const MAX_WALK_NODES = 4000;
const MAX_WALK_DEPTH = 16;

function chapterTitle(title: unknown): string {
  if (typeof title === 'string') return title.trim().slice(0, 120);
  if (!title || typeof title !== 'object') return '';
  const row = title as { simpleText?: unknown; runs?: Array<{ text?: unknown }> };
  if (typeof row.simpleText === 'string') return row.simpleText.trim().slice(0, 120);
  const runs = Array.isArray(row.runs) ? row.runs : [];
  return runs
    .map((run) => (typeof run?.text === 'string' ? run.text : ''))
    .join('')
    .trim()
    .slice(0, 120);
}

export function youtubeChapterMarkersFromMap(markersMap: unknown): YoutubeMarker[] {
  const entries = Array.isArray(markersMap)
    ? markersMap
    : (markersMap && typeof markersMap === 'object' ? Object.values(markersMap as Record<string, unknown>) : []);
  const markers: YoutubeMarker[] = [];
  const seen = new Set<number>();
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as { value?: { chapters?: unknown }; chapters?: unknown };
    const chapters = row.value?.chapters ?? row.chapters;
    if (!Array.isArray(chapters)) continue;
    for (const chapter of chapters) {
      if (!chapter || typeof chapter !== 'object') continue;
      const item = chapter as {
        chapterRenderer?: { timeRangeStartMillis?: unknown; title?: unknown };
        startMillis?: unknown;
        title?: unknown;
      };
      const renderer = item.chapterRenderer;
      const startMillis = Number(renderer?.timeRangeStartMillis ?? item.startMillis);
      const title = chapterTitle(renderer?.title ?? item.title);
      if (!Number.isFinite(startMillis) || startMillis < 0 || !title || seen.has(startMillis)) continue;
      seen.add(startMillis);
      markers.push({ startMillis, title });
      if (markers.length >= MAX_CHAPTERS) return markers;
    }
  }
  return markers;
}

function markersMapAtPlayerBar(root: unknown): unknown {
  const data = root as {
    playerOverlays?: {
      playerOverlayRenderer?: {
        decoratedPlayerBarRenderer?: {
          decoratedPlayerBarRenderer?: {
            playerBar?: {
              multiMarkersPlayerBarRenderer?: { markersMap?: unknown };
            };
          };
        };
      };
    };
  };
  return data.playerOverlays
    ?.playerOverlayRenderer
    ?.decoratedPlayerBarRenderer
    ?.decoratedPlayerBarRenderer
    ?.playerBar
    ?.multiMarkersPlayerBarRenderer
    ?.markersMap;
}

function walkForChapterMarkers(root: unknown): YoutubeMarker[] {
  let found: YoutubeMarker[] = [];
  let nodes = 0;

  function walk(value: unknown, depth: number): void {
    if (found.length > 0) return;
    if (!value || typeof value !== 'object' || depth > MAX_WALK_DEPTH || nodes++ > MAX_WALK_NODES) return;
    if (typeof Node !== 'undefined' && value instanceof Node) return;
    if (Array.isArray(value)) {
      const limit = Math.min(value.length, 40);
      for (let i = 0; i < limit; i++) walk(value[i], depth + 1);
      return;
    }
    const obj = value as Record<string, unknown>;
    if (obj.markersMap) {
      const markers = youtubeChapterMarkersFromMap(obj.markersMap);
      if (markers.length > 0) {
        found = markers;
        return;
      }
    }
    for (const child of Object.values(obj)) walk(child, depth + 1);
  }

  walk(root, 0);
  return found;
}

/** Chapters YouTube draws on the player bar. They live on `markersMap`, usually inside `ytInitialData`. */
export function findYoutubeChapterMarkers(root: unknown): YoutubeMarker[] {
  if (!root || typeof root !== 'object') return [];
  const direct = youtubeChapterMarkersFromMap((root as { markersMap?: unknown }).markersMap);
  if (direct.length > 0) return direct;
  const atBar = youtubeChapterMarkersFromMap(markersMapAtPlayerBar(root));
  if (atBar.length > 0) return atBar;
  const overlays = (root as { playerOverlays?: unknown }).playerOverlays;
  return overlays ? walkForChapterMarkers(overlays) : [];
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
