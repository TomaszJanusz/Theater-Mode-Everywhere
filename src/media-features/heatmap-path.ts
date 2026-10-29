type HeatmapPathSegment = {
  startMs: number;
  durationMs: number;
  intensity: number;
};

export const HEATMAP_PATH_WIDTH = 1000;
const PATH_HEIGHT = 100;
const MIN_HEIGHT = 2;
const MAX_HEIGHT = 94;

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
    const x = clamp((mid / end) * HEATMAP_PATH_WIDTH, 0, HEATMAP_PATH_WIDTH);
    const intensity = clamp(segment.intensity, 0, 1);
    const raised = MIN_HEIGHT + intensity * (MAX_HEIGHT - MIN_HEIGHT);
    const h = clamp(Math.max(raised, clamp(floor, 0, 1) * PATH_HEIGHT), MIN_HEIGHT, MAX_HEIGHT);
    return { x, y: PATH_HEIGHT - h };
  });
  pts.unshift({ x: 0, y: PATH_HEIGHT - MIN_HEIGHT });
  pts.push({ x: HEATMAP_PATH_WIDTH, y: PATH_HEIGHT - MIN_HEIGHT });

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
  d += ` L ${HEATMAP_PATH_WIDTH} ${PATH_HEIGHT} L 0 ${PATH_HEIGHT} Z`;
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

