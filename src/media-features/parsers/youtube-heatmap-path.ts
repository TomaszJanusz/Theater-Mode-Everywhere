type HeatmapPathSegment = {
  startMs: number;
  durationMs: number;
  intensity: number;
};

const PATH_WIDTH = 1000;
const PATH_HEIGHT = 100;
const MIN_HEIGHT = 2;
const MAX_HEIGHT = 94;
const MIN_SVG_PATH_LENGTH = 20;

function seriesEnd(segments: HeatmapPathSegment[]): number {
  let end = 0;
  for (const segment of segments) {
    const at = segment.startMs + segment.durationMs;
    if (at > end) end = at;
  }
  return end;
}

function fmt(value: number): string {
  return (Math.round(value * 100) / 100).toString();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Builds a closed area path in viewBox 0 0 1000 100 from Most Replayed segments. */
export function heatmapSvgPath(
  segments: HeatmapPathSegment[],
  durationMs?: number,
  floor = 0
): string {
  if (!Array.isArray(segments) || segments.length === 0) return '';
  const usable = segments.filter((segment) => (
    Number.isFinite(segment.startMs)
    && Number.isFinite(segment.durationMs)
    && Number.isFinite(segment.intensity)
    && segment.durationMs > 0
  ));
  if (usable.length === 0) return '';
  const end = durationMs && durationMs > 0
    ? durationMs
    : seriesEnd(usable);
  if (!(end > 0)) return '';

  const pts = usable.map((segment) => {
    const mid = segment.startMs + segment.durationMs / 2;
    const x = clamp((mid / end) * PATH_WIDTH, 0, PATH_WIDTH);
    const intensity = clamp(segment.intensity, 0, 1);
    const raised = MIN_HEIGHT + intensity * (MAX_HEIGHT - MIN_HEIGHT);
    const h = clamp(Math.max(raised, clamp(floor, 0, 1) * PATH_HEIGHT), MIN_HEIGHT, MAX_HEIGHT);
    return { x, y: PATH_HEIGHT - h };
  });
  pts.unshift({ x: 0, y: PATH_HEIGHT - MIN_HEIGHT });
  pts.push({ x: PATH_WIDTH, y: PATH_HEIGHT - MIN_HEIGHT });

  let d = `M ${fmt(pts[0].x)} ${fmt(pts[0].y)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i === 0 ? i : i - 1];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) * 0.2;
    const c1y = p1.y + (p2.y - p0.y) * 0.2;
    const c2x = p2.x - (p3.x - p1.x) * 0.2;
    const c2y = p2.y - (p3.y - p1.y) * 0.2;
    d += ` C ${fmt(c1x)} ${fmt(c1y)} ${fmt(c2x)} ${fmt(c2y)} ${fmt(p2.x)} ${fmt(p2.y)}`;
  }
  d += ` L ${PATH_WIDTH} ${PATH_HEIGHT} L 0 ${PATH_HEIGHT} Z`;
  return d;
}

/** Open ridge of a closed heatmap area, for a top-only stroke. */
export function heatmapRidgePath(d: string): string {
  const src = d.trim();
  if (!src) return '';
  const closed = src.match(
    /^(.*?)(?:[Ll][\s,]*-?[\d.]+(?:e[-+]?\d+)?[\s,]+-?[\d.]+(?:e[-+]?\d+)?\s*){1,2}[Zz]?\s*$/
  );
  if (closed?.[1]) return closed[1].trim();
  return src.replace(/\s*[Zz]\s*$/, '').trim();
}

type HeatmapPathNode = {
  getAttribute(name: string): string | null;
  closest?(selector: string): { getBoundingClientRect(): { left: number; width: number } } | null;
};

type HeatmapSlice = {
  d: string;
  origin: number;
  span: number;
};

function scaleHeatmapPathX(d: string, origin: number, span: number): string {
  return d.replace(
    /(-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)(\s*,\s*|\s+)(-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)/gi,
    (_match, x: string, sep: string, y: string) => {
      const next = origin + (Number(x) / PATH_WIDTH) * span;
      const rounded = Math.round(next * 100) / 100;
      return `${rounded}${sep.includes(',') ? ',' : ' '}${y}`;
    }
  );
}

function measureHeatmapSlice(path: HeatmapPathNode): HeatmapSlice | null {
  const d = (path.getAttribute('d') || '').trim();
  if (d.length <= MIN_SVG_PATH_LENGTH || typeof path.closest !== 'function') return null;
  const chapter = path.closest('.ytp-heat-map-chapter');
  const container = path.closest('.ytp-heat-map-container');
  if (!chapter || !container) return null;
  let chapterBox: { left: number; width: number };
  let containerBox: { left: number; width: number };
  try {
    chapterBox = chapter.getBoundingClientRect();
    containerBox = container.getBoundingClientRect();
  } catch {
    return null;
  }
  if (!(containerBox.width > 0) || !(chapterBox.width > 0)) return null;
  const origin = ((chapterBox.left - containerBox.left) / containerBox.width) * PATH_WIDTH;
  const span = (chapterBox.width / containerBox.width) * PATH_WIDTH;
  if (!Number.isFinite(origin) || !Number.isFinite(span) || span <= 0) return null;
  return { d, origin, span };
}

/**
 * YouTube draws one SVG per chapter, each normalized to viewBox 0..1000.
 * A single chapter path stretched across the whole scrubber is a different chart.
 */
function combineRenderedHeatmapPaths(paths: HeatmapPathNode[]): string | null {
  const slices = paths.map(measureHeatmapSlice).filter((slice): slice is HeatmapSlice => Boolean(slice));
  if (slices.length !== paths.length || slices.length === 0) return null;
  slices.sort((a, b) => a.origin - b.origin);
  if (slices.length === 1 && slices[0].span >= PATH_WIDTH * 0.98) return slices[0].d;
  return slices.map((slice) => scaleHeatmapPathX(slice.d, slice.origin, slice.span)).join(' ');
}

export function readRenderedYoutubeHeatmapPath(
  root: Pick<ParentNode, 'querySelectorAll'> | null | undefined = typeof document !== 'undefined' ? document : null
): string | null {
  if (!root) return null;
  let candidates: ArrayLike<HeatmapPathNode>;
  try {
    candidates = root.querySelectorAll('path.ytp-modern-heat-map[d], .ytp-heat-map-path[d]') as ArrayLike<HeatmapPathNode>;
  } catch {
    return null;
  }
  const paths: HeatmapPathNode[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const d = (candidates[i].getAttribute('d') || '').trim();
    if (d.length > MIN_SVG_PATH_LENGTH) paths.push(candidates[i]);
  }
  if (paths.length === 0) return null;
  if (paths.length > 1) return combineRenderedHeatmapPaths(paths);
  return combineRenderedHeatmapPaths(paths) || (paths[0].getAttribute('d') || '').trim();
}
