/** A run of title text; `className` keeps the title/separator/subtitle styling of the full title. */
export type TitleSegment = { readonly text: string; readonly className?: string };

const TAIL_MAX = 28;
const MIN_PART = 8;

function sliceSegments(segments: readonly TitleSegment[], from: number, to: number): TitleSegment[] {
  const out: TitleSegment[] = [];
  let offset = 0;
  for (const segment of segments) {
    const start = Math.max(from - offset, 0);
    const end = Math.min(to - offset, segment.text.length);
    if (end > start) out.push({ ...segment, text: segment.text.slice(start, end) });
    offset += segment.text.length;
  }
  return out;
}

/**
 * Splits an overflowing title into a flexible head and a fixed tail. Episode numbers and
 * series/channel suffixes tend to end a title, so the tail keeps up to 28 characters from a
 * word boundary while CSS ellipsizes the head's end. Nothing is measured: the browser decides
 * how much of the head fits. Returns no tail when the title is too short to split usefully.
 */
export function splitTitleForTruncation(segments: readonly TitleSegment[]): { head: TitleSegment[]; tail: TitleSegment[] } {
  const full = segments.map(segment => segment.text).join('');
  let start = full.length - TAIL_MAX;
  if (start < MIN_PART) return { head: sliceSegments(segments, 0, full.length), tail: [] };
  const space = full.indexOf(' ', start);
  if (space !== -1 && full.length - space > MIN_PART) start = space;
  else if (/[\uDC00-\uDFFF]/.test(full[start])) start += 1; // Do not cut a surrogate pair.
  return { head: sliceSegments(segments, 0, start), tail: sliceSegments(segments, start, full.length) };
}
