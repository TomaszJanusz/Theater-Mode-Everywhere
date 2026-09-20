export type YoutubeHeatmapSource = 'markers' | 'legacy' | 'svg';

export type YoutubeHeatmapSegment = {
  startMs: number;
  durationMs: number;
  intensity: number;
};

export type YoutubeHeatmap = {
  source: YoutubeHeatmapSource;
  segments?: YoutubeHeatmapSegment[];
  svgPath?: string;
};

const MAX_WALK_NODES = 12000;
const MAX_WALK_DEPTH = 40;
const MAX_HEATMAP_SEGMENTS = 400;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function toFiniteNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeModernMarkers(markers: unknown): YoutubeHeatmapSegment[] {
  if (!Array.isArray(markers)) return [];
  const out: YoutubeHeatmapSegment[] = [];
  for (const item of markers) {
    const row = asRecord(item);
    if (!row) continue;
    const startMs = toFiniteNumber(row.startMillis);
    const durationMs = toFiniteNumber(row.durationMillis);
    const intensity = toFiniteNumber(row.intensityScoreNormalized);
    if (startMs == null || durationMs == null || intensity == null) continue;
    out.push({ startMs, durationMs, intensity });
    if (out.length >= MAX_HEATMAP_SEGMENTS) break;
  }
  return out;
}

function normalizeLegacyMarkers(heatMarkers: unknown): YoutubeHeatmapSegment[] {
  if (!Array.isArray(heatMarkers)) return [];
  const out: YoutubeHeatmapSegment[] = [];
  for (const item of heatMarkers) {
    const wrapper = asRecord(item);
    const row = asRecord(wrapper?.heatMarkerRenderer) || wrapper;
    if (!row) continue;
    const startMs = toFiniteNumber(row.timeRangeStartMillis);
    const durationMs = toFiniteNumber(row.markerDurationMillis);
    const intensity = toFiniteNumber(row.heatMarkerIntensityScoreNormalized);
    if (startMs == null || durationMs == null || intensity == null) continue;
    out.push({ startMs, durationMs, intensity });
    if (out.length >= MAX_HEATMAP_SEGMENTS) break;
  }
  return out;
}

export function validateYoutubeHeatmap(segments: YoutubeHeatmapSegment[] | null | undefined): segments is YoutubeHeatmapSegment[] {
  if (!Array.isArray(segments) || segments.length === 0) return false;
  return segments.every((segment, index) => (
    Number.isFinite(segment.startMs)
    && Number.isFinite(segment.durationMs)
    && Number.isFinite(segment.intensity)
    && segment.startMs >= 0
    && segment.durationMs > 0
    && (index === 0 || segment.startMs >= segments[index - 1].startMs)
  ));
}

export function findYoutubeHeatmap(root: unknown): YoutubeHeatmap | null {
  let markers: YoutubeHeatmapSegment[] | null = null;
  let legacy: YoutubeHeatmapSegment[] | null = null;
  let nodes = 0;

  function walk(value: unknown, depth: number): void {
    if (markers && legacy) return;
    if (!value || typeof value !== 'object' || depth > MAX_WALK_DEPTH || nodes++ > MAX_WALK_NODES) return;
    if (typeof Node !== 'undefined' && value instanceof Node) return;

    if (Array.isArray(value)) {
      const limit = Math.min(value.length, 2500);
      for (let i = 0; i < limit; i++) walk(value[i], depth + 1);
      return;
    }

    const obj = value as Record<string, unknown>;
    if (!markers && obj.markerType === 'MARKER_TYPE_HEATMAP') {
      const found = normalizeModernMarkers(obj.markers);
      if (validateYoutubeHeatmap(found)) markers = found;
    }
    if (!legacy) {
      const renderer = asRecord(obj.heatmapRenderer);
      const found = renderer ? normalizeLegacyMarkers(renderer.heatMarkers) : [];
      if (validateYoutubeHeatmap(found)) legacy = found;
    }
    if (markers && legacy) return;
    for (const child of Object.values(obj)) walk(child, depth + 1);
  }

  walk(root, 0);
  if (markers) return { source: 'markers', segments: markers };
  if (legacy) return { source: 'legacy', segments: legacy };
  return null;
}

export function youtubeHeatmapHarvestMatchesPage(
  pageVideoId: string | null,
  jsonVideoId: string | null | undefined
): boolean {
  if (pageVideoId && jsonVideoId && pageVideoId !== jsonVideoId) return false;
  return true;
}

export function isYoutubeWatchJsonUrl(url: string, pageHref?: string): boolean {
  if (!url) return true;
  try {
    const parsed = new URL(url, pageHref || 'https://www.youtube.com');
    const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
    const youtubeHost = host === 'youtube.com'
      || host === 'youtu.be'
      || host === 'youtube-nocookie.com'
      || host.endsWith('.youtube.com')
      || host.endsWith('.youtube-nocookie.com');
    if (!youtubeHost) return false;
    return /\/youtubei\//i.test(parsed.pathname) || /\/(?:watch|get_watch)\b/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

export function youtubeWatchJsonVideoId(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, any>;
  const candidates = [
    obj.videoDetails?.videoId,
    obj.playerResponse?.videoDetails?.videoId,
    obj.currentVideoEndpoint?.watchEndpoint?.videoId,
    obj.response?.currentVideoEndpoint?.watchEndpoint?.videoId,
    obj.nextResponse?.currentVideoEndpoint?.watchEndpoint?.videoId
  ];
  for (const id of candidates) {
    if (typeof id === 'string' && id.length > 0 && id.length <= 20) return id;
  }
  return null;
}
