import type { PreviewFrame } from '../types';

export type TwitchStoryboardSet = {
  duration: number;
  count: number;
  tileWidth: number;
  tileHeight: number;
  columns: number;
  rows: number;
  sheetWidth: number;
  sheetHeight: number;
  images: string[];
};

export function isSafeTwitchStoryboardHost(hostname: string): boolean {
  const host = hostname.replace(/^www\./i, '').toLowerCase();
  return host === 'vod-secure.twitch.tv'
    || host === 'vod-storyboards.twitch.tv'
    || host === 'static-cdn.jtvnw.net'
    || /^d[a-z0-9]{6,}\.cloudfront\.net$/i.test(host);
}

export function isSafeTwitchStoryboardJsonUrl(url: string, baseUrl?: string): boolean {
  try {
    const parsed = new URL(url, baseUrl || 'https://www.twitch.tv');
    if (parsed.protocol !== 'https:') return false;
    if (!isSafeTwitchStoryboardHost(parsed.hostname)) return false;
    return /\/storyboards\/[^/?#]*info\.json$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

export function isSafeTwitchImageUrl(url: string, baseUrl?: string): boolean {
  try {
    const parsed = new URL(url, baseUrl || 'https://www.twitch.tv');
    if (parsed.protocol !== 'https:') return false;
    if (!isSafeTwitchStoryboardHost(parsed.hostname)) return false;
    return /\/storyboards\//i.test(parsed.pathname) && /\.(jpe?g|webp)$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function positiveInt(value: unknown): number | null {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return Math.floor(number);
}

export function parseTwitchSeekPreviews(
  body: string,
  duration: number,
  baseUrl: string
): TwitchStoryboardSet | null {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return null;
  }
  if (!Array.isArray(data) || data.length === 0) return null;

  const levels: TwitchStoryboardSet[] = [];
  for (const entry of data) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    const tileWidth = positiveInt(item.width);
    const tileHeight = positiveInt(item.height);
    const count = positiveInt(item.count);
    const columns = positiveInt(item.cols ?? item.columns);
    const rows = positiveInt(item.rows);
    const images = Array.isArray(item.images) ? item.images : [];
    const interval = Number(item.interval);
    if (!tileWidth || !tileHeight || !count || !columns || !rows || images.length === 0) continue;

    const resolved: string[] = [];
    for (const image of images) {
      if (typeof image !== 'string' || !image.trim()) continue;
      try {
        const href = new URL(image, baseUrl).toString();
        if (isSafeTwitchImageUrl(href)) resolved.push(href);
      } catch {
        continue;
      }
    }
    if (resolved.length === 0) continue;
    const fromInterval = Number.isFinite(interval) && interval >= 1 ? count * interval : 0;
    levels.push({
      duration: Number.isFinite(duration) && duration > 0 ? duration : fromInterval,
      count,
      tileWidth,
      tileHeight,
      columns,
      rows,
      sheetWidth: tileWidth * columns,
      sheetHeight: tileHeight * rows,
      images: resolved
    });
  }
  if (levels.length === 0) return null;
  levels.sort((left, right) => (right.tileWidth * right.tileHeight) - (left.tileWidth * left.tileHeight));
  return levels[0];
}

export function getTwitchPreviewFrame(
  set: TwitchStoryboardSet,
  time: number,
  duration = set.duration
): PreviewFrame | null {
  if (!Number.isFinite(time) || time < 0 || set.count <= 0) return null;
  const total = Number.isFinite(duration) && duration > 0 ? duration : set.duration;
  if (!Number.isFinite(total) || total <= 0) return null;

  const maxIndex = set.count - 1;
  const frameIndex = Math.max(0, Math.min(maxIndex, Math.floor((time / total) * set.count)));
  const tilesPerSheet = set.columns * set.rows;
  if (tilesPerSheet <= 0) return null;
  const sheetIndex = Math.min(set.images.length - 1, Math.floor(frameIndex / tilesPerSheet));
  const url = set.images[sheetIndex];
  if (!url || !isSafeTwitchImageUrl(url)) return null;
  const tileIndex = frameIndex % tilesPerSheet;
  const col = tileIndex % set.columns;
  const row = Math.floor(tileIndex / set.columns);
  return {
    time: (frameIndex / set.count) * total,
    width: set.tileWidth,
    height: set.tileHeight,
    image: {
      kind: 'sprite',
      url,
      x: col * set.tileWidth,
      y: row * set.tileHeight,
      tileWidth: set.tileWidth,
      tileHeight: set.tileHeight,
      sheetWidth: set.sheetWidth,
      sheetHeight: set.sheetHeight
    }
  };
}
