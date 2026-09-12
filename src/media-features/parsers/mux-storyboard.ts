import { parseTimestamp } from './captions';
import type { PreviewFrame } from '../types';

export type MuxStoryboardCue = {
  start: number;
  end: number;
  url: string;
  x: number;
  y: number;
  tileWidth: number;
  tileHeight: number;
  sheetWidth: number;
  sheetHeight: number;
};

export type MuxStoryboardSet = {
  duration: number;
  cues: MuxStoryboardCue[];
};

const XYWH_RE = /#xywh=(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*$/i;

export function isSafeMuxImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    return parsed.hostname.replace(/^www\./i, '').toLowerCase() === 'image.mux.com';
  } catch {
    return false;
  }
}

function imageUrlWithoutHash(url: string): string | null {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    const href = parsed.toString();
    return isSafeMuxImageUrl(href) ? href : null;
  } catch {
    return null;
  }
}

function parseXywh(url: string): { x: number; y: number; w: number; h: number } | null {
  const hashIndex = url.indexOf('#');
  const hash = hashIndex >= 0 ? url.slice(hashIndex) : '';
  const match = hash.match(XYWH_RE);
  if (!match) return null;
  const x = Number(match[1]);
  const y = Number(match[2]);
  const w = Number(match[3]);
  const h = Number(match[4]);
  if (![x, y, w, h].every((value) => Number.isFinite(value)) || w <= 0 || h <= 0) return null;
  return { x, y, w, h };
}

function withSheetSizes(
  tiles: Array<{ start: number; end: number; url: string; x: number; y: number; w: number; h: number }>
): MuxStoryboardCue[] {
  const sheets = new Map<string, { width: number; height: number }>();
  for (const tile of tiles) {
    const prev = sheets.get(tile.url) || { width: 0, height: 0 };
    sheets.set(tile.url, {
      width: Math.max(prev.width, tile.x + tile.w),
      height: Math.max(prev.height, tile.y + tile.h)
    });
  }
  return tiles.map((tile) => {
    const sheet = sheets.get(tile.url) || { width: tile.w, height: tile.h };
    return {
      start: tile.start,
      end: tile.end,
      url: tile.url,
      x: tile.x,
      y: tile.y,
      tileWidth: tile.w,
      tileHeight: tile.h,
      sheetWidth: sheet.width,
      sheetHeight: sheet.height
    };
  });
}

export function parseMuxStoryboardVtt(body: string): MuxStoryboardSet | null {
  const lines = body.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').split('\n');
  const raw: Array<{ start: number; end: number; url: string; x: number; y: number; w: number; h: number }> = [];
  let i = 0;
  while (i < lines.length) {
    while (i < lines.length && lines[i].trim() === '') i += 1;
    if (i >= lines.length) break;
    const line = lines[i];
    if (/^WEBVTT/i.test(line) || /^NOTE\b/i.test(line) || /^STYLE\b/i.test(line) || /^REGION\b/i.test(line)) {
      i += 1;
      while (i < lines.length && lines[i].trim() !== '' && !lines[i].includes('-->')) i += 1;
      continue;
    }
    if (/^\d+$/.test(line.trim()) && i + 1 < lines.length && lines[i + 1].includes('-->')) {
      i += 1;
    }
    if (!lines[i] || !lines[i].includes('-->')) {
      i += 1;
      continue;
    }
    const [startRaw, endRaw] = lines[i].split('-->');
    const start = parseTimestamp((startRaw || '').trim().split(/\s+/)[0] || '');
    const end = parseTimestamp((endRaw || '').trim().split(/\s+/)[0] || '');
    i += 1;
    const textLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== '') {
      textLines.push(lines[i].trim());
      i += 1;
    }
    if (start === null || end === null || end <= start) continue;
    const payload = textLines.find((item) => item.includes('xywh=')) || textLines[0] || '';
    const xywh = parseXywh(payload);
    const url = imageUrlWithoutHash(payload);
    if (!xywh || !url) continue;
    raw.push({ start, end, url, ...xywh });
  }
  if (raw.length === 0) return null;
  const cues = withSheetSizes(raw);
  return { duration: cues[cues.length - 1].end, cues };
}

export function parseMuxStoryboardJson(body: string): MuxStoryboardSet | null {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(body) as Record<string, unknown>;
  } catch {
    return null;
  }
  const sheetUrl = typeof data.url === 'string' ? imageUrlWithoutHash(data.url) : null;
  const tileWidth = Number(data.tile_width ?? data.tileWidth);
  const tileHeight = Number(data.tile_height ?? data.tileHeight);
  const tiles = Array.isArray(data.tiles) ? data.tiles : [];
  if (!sheetUrl || !tileWidth || !tileHeight || tiles.length === 0) return null;

  const parsedTiles: Array<{ start: number; end: number; url: string; x: number; y: number; w: number; h: number }> = [];
  for (let index = 0; index < tiles.length; index++) {
    const tile = tiles[index];
    if (!tile || typeof tile !== 'object') continue;
    const item = tile as Record<string, unknown>;
    const start = Number(item.start ?? item.start_time);
    const x = Number(item.x);
    const y = Number(item.y);
    if (!Number.isFinite(start) || start < 0 || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    parsedTiles.push({
      start,
      end: start,
      url: sheetUrl,
      x,
      y,
      w: tileWidth,
      h: tileHeight
    });
  }
  if (parsedTiles.length === 0) return null;
  parsedTiles.sort((a, b) => a.start - b.start);
  const duration = Number(data.duration);
  for (let index = 0; index < parsedTiles.length; index++) {
    const next = parsedTiles[index + 1];
    parsedTiles[index].end = next
      ? next.start
      : (Number.isFinite(duration) && duration > parsedTiles[index].start ? duration : parsedTiles[index].start + 1);
  }
  const cues = withSheetSizes(parsedTiles);
  return {
    duration: Number.isFinite(duration) && duration > 0 ? duration : cues[cues.length - 1].end,
    cues
  };
}

export function parseMuxStoryboard(body: string): MuxStoryboardSet | null {
  const trimmed = body.replace(/^\uFEFF/, '').trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{')) return parseMuxStoryboardJson(trimmed);
  return parseMuxStoryboardVtt(trimmed);
}

export function getMuxPreviewFrame(set: MuxStoryboardSet, time: number): PreviewFrame | null {
  if (!Number.isFinite(time) || time < 0 || set.cues.length === 0) return null;
  let cue = set.cues[0];
  for (const candidate of set.cues) {
    if (time >= candidate.start) cue = candidate;
    else break;
  }
  if (!isSafeMuxImageUrl(cue.url)) return null;
  return {
    time: cue.start,
    width: cue.tileWidth,
    height: cue.tileHeight,
    image: {
      kind: 'sprite',
      url: cue.url,
      x: cue.x,
      y: cue.y,
      tileWidth: cue.tileWidth,
      tileHeight: cue.tileHeight,
      sheetWidth: cue.sheetWidth,
      sheetHeight: cue.sheetHeight
    }
  };
}
