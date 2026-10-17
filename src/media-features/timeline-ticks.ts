import type { TimelineMarker } from './types';

/** Positions closer than this share one tick (0.01% of the track, far below a pixel). */
const TICK_EPSILON = 1e-4;

/**
 * Normalized tick positions for chapter starts and SponsorBlock segment boundaries.
 * Sorted, deduplicated, and limited to the open interval (0, 1): the track edges need no tick.
 */
export function timelineTickPositions(
  markers: readonly TimelineMarker[],
  chapterStarts: readonly number[]
): number[] {
  const candidates = [...chapterStarts];
  for (const marker of markers) candidates.push(marker.start, marker.end);
  const sorted = candidates
    .filter(position => Number.isFinite(position) && position > TICK_EPSILON && position < 1 - TICK_EPSILON)
    .sort((a, b) => a - b);
  const ticks: number[] = [];
  for (const position of sorted) {
    if (ticks.length === 0 || position - ticks[ticks.length - 1] > TICK_EPSILON) ticks.push(position);
  }
  return ticks;
}
