import type { PreviewFrame } from '../types';
import { PREVIEW_DISPLAY_WIDTH } from '../preview-display';

export type StoryboardLevel = {
  width: number;
  height: number;
  count: number;
  cols: number;
  rows: number;
  intervalMs: number;
  urlTemplate: string;
};

export type StoryboardSet = {
  duration: number;
  levels: StoryboardLevel[];
};

function isSafeStoryboardUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    return /(^|\.)ytimg\.com$/i.test(parsed.hostname);
  } catch {
    return false;
  }
}

export function parseStoryboardSpec(spec: string, duration = 0): StoryboardSet | null {
  const parts = spec.split('|');
  if (parts.length < 2) return null;
  const baseUrl = parts[0];
  const levels: StoryboardLevel[] = [];

  for (let i = 1; i < parts.length; i++) {
    const params = parts[i].split('#');
    if (params.length < 8) continue;
    const width = Number(params[0]);
    const height = Number(params[1]);
    const count = Number(params[2]);
    const cols = Number(params[3]);
    const rows = Number(params[4]);
    const intervalMs = Number(params[5]);
    let replacement = params[6] || '$M';
    const sigh = params[7] || '';
    if (!width || !height || !count || !cols || !rows) continue;
    if (replacement === 'default') replacement = '$M';

    const levelIndex = i - 1;
    let url = baseUrl.replace('$L', String(levelIndex)).replace('$N', replacement);
    if (sigh && !/[?&]sigh=/.test(url)) {
      url += (url.includes('?') ? '&' : '?') + 'sigh=' + encodeURIComponent(sigh);
    }
    if (!isSafeStoryboardUrl(url.replace('$M', '0'))) continue;

    levels.push({
      width,
      height,
      count,
      cols,
      rows,
      intervalMs: Number.isFinite(intervalMs) ? intervalMs : 0,
      urlTemplate: url
    });
  }

  if (levels.length === 0) return null;
  return { duration, levels };
}

export function pickStoryboardLevel(set: StoryboardSet, targetWidth = PREVIEW_DISPLAY_WIDTH): StoryboardLevel {
  let best = set.levels[0];
  let bestDelta = Math.abs(best.width - targetWidth);
  for (const level of set.levels) {
    const delta = Math.abs(level.width - targetWidth);
    if (delta < bestDelta || (delta === bestDelta && level.width > best.width)) {
      best = level;
      bestDelta = delta;
    }
  }
  return best;
}

export function getStoryboardFrame(
  set: StoryboardSet,
  time: number,
  targetWidth = PREVIEW_DISPLAY_WIDTH
): PreviewFrame | null {
  if (!Number.isFinite(time) || time < 0) return null;
  const level = pickStoryboardLevel(set, targetWidth);
  const duration = set.duration > 0 ? set.duration : (level.intervalMs > 0 ? (level.count * level.intervalMs) / 1000 : 0);
  if (duration <= 0 && level.intervalMs <= 0) return null;

  const interval = level.intervalMs > 0 ? level.intervalMs / 1000 : duration / level.count;
  if (!Number.isFinite(interval) || interval <= 0) return null;

  const maxIndex = Math.max(0, level.count - 1);
  const frameIndex = Math.max(0, Math.min(maxIndex, Math.floor(time / interval)));
  const tilesPerSheet = level.cols * level.rows;
  const sheetIndex = Math.floor(frameIndex / tilesPerSheet);
  const tileIndex = frameIndex % tilesPerSheet;
  const col = tileIndex % level.cols;
  const row = Math.floor(tileIndex / level.cols);
  const url = level.urlTemplate.replace('$M', String(sheetIndex));
  if (!isSafeStoryboardUrl(url)) return null;

  return {
    time: frameIndex * interval,
    width: level.width,
    height: level.height,
    image: {
      kind: 'sprite',
      url,
      x: col * level.width,
      y: row * level.height,
      tileWidth: level.width,
      tileHeight: level.height,
      sheetWidth: level.cols * level.width,
      sheetHeight: level.rows * level.height
    }
  };
}
