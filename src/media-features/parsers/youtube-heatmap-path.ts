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

function fmt(value: number): string {
  return (Math.round(value * 100) / 100).toString();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Builds a closed area path in viewBox 0 0 1000 100 from Most Replayed segments. */
export function heatmapSvgPath(segments: HeatmapPathSegment[], durationMs?: number): string {
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
    : Math.max(...usable.map((segment) => segment.startMs + segment.durationMs));
  if (!(end > 0)) return '';

  const pts = usable.map((segment) => {
    const mid = segment.startMs + segment.durationMs / 2;
    const x = clamp((mid / end) * PATH_WIDTH, 0, PATH_WIDTH);
    const intensity = clamp(segment.intensity, 0, 1);
    const h = MIN_HEIGHT + intensity * (MAX_HEIGHT - MIN_HEIGHT);
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

export function readRenderedYoutubeHeatmapPath(
  root: Pick<ParentNode, 'querySelectorAll'> | null | undefined = typeof document !== 'undefined' ? document : null
): string | null {
  if (!root) return null;
  let candidates: ArrayLike<{ getAttribute(name: string): string | null }>;
  try {
    candidates = root.querySelectorAll('path.ytp-modern-heat-map[d], .ytp-heat-map-path[d]');
  } catch {
    return null;
  }
  for (let i = 0; i < candidates.length; i++) {
    const d = (candidates[i].getAttribute('d') || '').trim();
    if (d.length > MIN_SVG_PATH_LENGTH) return d;
  }
  return null;
}
