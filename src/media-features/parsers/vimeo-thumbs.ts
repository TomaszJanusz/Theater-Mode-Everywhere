import type { PreviewFrame } from '../types';

export type VimeoThumbSprite = {
  url: string;
  sheetWidth: number;
  sheetHeight: number;
  frameWidth: number;
  frameHeight: number;
  columns: number;
  rows: number;
  frames: number;
  duration: number;
};

function isSafeVimeoSpriteUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    return /(^|\.)vimeocdn\.com$/i.test(parsed.hostname);
  } catch {
    return false;
  }
}

export function spriteUrlForSheet(url: string, sheetIndex: number): string {
  return url.replace(/(\.)(\d+)(\.(?:webp|jpg|jpeg|png))(?=\?|$)/i, `.${sheetIndex}$3`);
}

export function parseVimeoThumbPreview(
  raw: {
    url?: string;
    width?: number;
    height?: number;
    frameWidth?: number;
    frameHeight?: number;
    columns?: number;
    frames?: number;
  } | null | undefined,
  duration = 0
): VimeoThumbSprite | null {
  if (!raw || typeof raw.url !== 'string') return null;
  const frameWidth = Number(raw.frameWidth);
  const frameHeight = Number(raw.frameHeight);
  const columns = Number(raw.columns);
  const frames = Number(raw.frames);
  const sheetWidth = Number(raw.width);
  const sheetHeight = Number(raw.height);
  if (!frameWidth || !frameHeight || !columns || !frames || !sheetWidth || !sheetHeight) return null;
  if (!isSafeVimeoSpriteUrl(raw.url.replace(/(\.)(\d+)(\.(?:webp|jpg|jpeg|png))(?=\?|$)/i, '.0$3'))) {
    return null;
  }
  const rows = Math.max(1, Math.round(sheetHeight / frameHeight));
  return {
    url: raw.url,
    sheetWidth,
    sheetHeight,
    frameWidth,
    frameHeight,
    columns,
    rows,
    frames,
    duration
  };
}

export function getVimeoPreviewFrame(
  sprite: VimeoThumbSprite,
  time: number,
  duration = sprite.duration
): PreviewFrame | null {
  if (!Number.isFinite(time) || time < 0) return null;
  const total = duration > 0 ? duration : sprite.duration;
  if (!Number.isFinite(total) || total <= 0 || sprite.frames <= 0) return null;

  const maxIndex = sprite.frames - 1;
  const frameIndex = Math.max(0, Math.min(maxIndex, Math.floor((time / total) * sprite.frames)));
  const tilesPerSheet = sprite.columns * sprite.rows;
  const sheetIndex = tilesPerSheet > 0 ? Math.floor(frameIndex / tilesPerSheet) : 0;
  const tileIndex = tilesPerSheet > 0 ? frameIndex % tilesPerSheet : frameIndex;
  const col = tileIndex % sprite.columns;
  const row = Math.floor(tileIndex / sprite.columns);
  const url = spriteUrlForSheet(sprite.url, sheetIndex);
  if (!isSafeVimeoSpriteUrl(url)) return null;

  return {
    time: frameIndex * (total / sprite.frames),
    width: sprite.frameWidth,
    height: sprite.frameHeight,
    image: {
      kind: 'sprite',
      url,
      x: col * sprite.frameWidth,
      y: row * sprite.frameHeight,
      tileWidth: sprite.frameWidth,
      tileHeight: sprite.frameHeight,
      sheetWidth: sprite.sheetWidth,
      sheetHeight: sprite.sheetHeight
    }
  };
}
