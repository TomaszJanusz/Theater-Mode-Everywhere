import { HEATMAP_PATH_WIDTH } from '../heatmap-path';

const MIN_SVG_PATH_LENGTH = 20;

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
      const next = origin + (Number(x) / HEATMAP_PATH_WIDTH) * span;
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
  const origin = ((chapterBox.left - containerBox.left) / containerBox.width) * HEATMAP_PATH_WIDTH;
  const span = (chapterBox.width / containerBox.width) * HEATMAP_PATH_WIDTH;
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
  if (slices.length === 1 && slices[0].span >= HEATMAP_PATH_WIDTH * 0.98) return slices[0].d;
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
