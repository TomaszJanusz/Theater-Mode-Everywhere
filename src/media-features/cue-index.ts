import type { CaptionCue, CaptionWord, Chapter } from './types';

export function findCueIndex(cues: CaptionCue[], time: number): number {
  if (cues.length === 0) return -1;

  let low = 0;
  let high = cues.length - 1;
  let candidate = -1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    const cue = cues[mid];
    if (time < cue.start) {
      high = mid - 1;
    } else if (time >= cue.end) {
      low = mid + 1;
    } else {
      candidate = mid;
      break;
    }
  }

  if (candidate === -1) return -1;

  while (candidate > 0 && time >= cues[candidate - 1].start && time < cues[candidate - 1].end) {
    candidate -= 1;
  }
  return candidate;
}

export function findActiveCues(cues: CaptionCue[], time: number): CaptionCue[] {
  const start = findCueIndex(cues, time);
  if (start === -1) return [];

  const active: CaptionCue[] = [];
  for (let i = start; i < cues.length; i++) {
    const cue = cues[i];
    if (time < cue.start) break;
    if (time < cue.end) active.push(cue);
  }
  return active;
}

export function visibleCaptionLines(cues: CaptionCue[], time: number, maxLines = 2): CaptionCue[] {
  const active = findActiveCues(cues, time);
  if (active.length <= maxLines) return active;
  return active.slice(-maxLines);
}

export function cueHasWordTimings(cue: CaptionCue): boolean {
  const words = cue.words;
  if (!words || words.length < 2) return false;
  return words.some((word) => word.start > words[0].start + 0.05);
}

export function classifyCaptionWord(
  words: CaptionWord[],
  index: number,
  time: number
): 'past' | 'current' | 'upcoming' {
  const word = words[index];
  if (!word || time < word.start) return 'upcoming';
  const next = words[index + 1];
  if (!next || time < next.start) return 'current';
  return 'past';
}

export function chapterAtTime(chapters: Chapter[], time: number): Chapter | null {
  if (chapters.length === 0) return null;
  let match: Chapter | null = null;
  for (const chapter of chapters) {
    if (time + 0.0001 < chapter.start) break;
    const end = chapter.end ?? Number.POSITIVE_INFINITY;
    if (time < end) match = chapter;
  }
  return match;
}
