import { sanitizeContentTitle } from '../content-title';
import { isAllowedMediaFetchUrl } from '../fetch-allowlist';
import type { PreviewFrame } from '../types';

export type TencentCaption = { id: string; language: string; label: string; url: string };
export type TencentStoryboard = {
  baseUrl: string; link: string; name: string; interval: number;
  columns: number; rows: number; width: number; height: number; duration: number;
};
export type TencentSnapshot = {
  videoId: string; title?: string; duration?: number;
  captionTracks: TencentCaption[]; storyboard: TencentStoryboard | null;
};

export function tencentRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function tencentCaptionUrl(value: unknown, captionType: number): string | null {
  if (typeof value !== 'string' || value.length > 2000) return null;
  try {
    const url = new URL(value);
    // ThumbPlayer's VTT loader uses the complete file beside the HLS wrapper.
    if (captionType === 3) url.pathname = url.pathname.replace(/\.vtt\.m3u8$/i, '.vtt');
    if (url.protocol === 'http:') url.protocol = 'https:';
    return isAllowedMediaFetchUrl({ provider: 'tencent', kind: 'caption-track', url: url.href }) ? url.href : null;
  } catch { return null; }
}

export function parseTencentCaptions(raw: unknown, videoId: string): TencentCaption[] {
  if (!Array.isArray(raw)) return [];
  const result: TencentCaption[] = [];
  const ids = new Set<string>();
  for (const value of raw.slice(0, 64)) {
    const item = tencentRecord(value);
    const type = Number(item.captionType);
    if (![1, 3].includes(type) || (item.lmt !== undefined && Number(item.lmt) !== 0)) continue;
    const key = typeof item.keyid === 'string' ? item.keyid : '';
    if (/^[a-z0-9]{11}\./i.test(key) && !key.startsWith(`${videoId}.`)) continue;
    const alternatives = tencentRecord(item.urlList).ui;
    const urls = [item.url, ...(Array.isArray(alternatives) ? alternatives.slice(0, 8).map((u) => typeof u === 'string' ? u : tencentRecord(u).url) : [])];
    const url = urls.map((u) => tencentCaptionUrl(u, type)).find(Boolean);
    const idValue = typeof item.id === 'number' || typeof item.id === 'string' ? String(item.id) : '';
    if (!url || !idValue || idValue.length > 80 || ids.has(idValue)) continue;
    ids.add(idValue);
    const language = typeof item.lang === 'string' ? item.lang.toLowerCase().replace(/_/g, '-').slice(0, 35) : 'und';
    result.push({ id: `tencent:${videoId}:${idValue}`, language, label: sanitizeContentTitle(item.name) || language, url });
  }
  return result;
}

export function parseTencentStoryboard(raw: unknown, link: unknown, duration: number): TencentStoryboard | null {
  if (!Array.isArray(raw) || typeof link !== 'string' || !/^[a-z0-9_-]{1,100}$/i.test(link) || !(duration > 0 && duration <= 86400)) return null;
  const choices: TencentStoryboard[] = [];
  for (const value of raw.slice(0, 10)) {
    const item = tencentRecord(value);
    const [columns, rows, width, height, interval] = [item.c, item.r, item.w, item.h, item.cd].map(Number);
    if (![columns, rows, width, height].every((n) => Number.isInteger(n) && n > 0 && n <= 2048)
      || columns * width > 32768 || rows * height > 32768 || !(interval >= 0.1 && interval <= 3600)) continue;
    if (typeof item.fn !== 'string' || !/^q[1-9]\d?$/.test(item.fn) || typeof item.url !== 'string') continue;
    try {
      const base = new URL(item.url);
      if (base.protocol === 'http:') base.protocol = 'https:';
      if (base.protocol !== 'https:' || base.username || base.password || base.port || base.search || base.hash
        || !['video-caps.wetvinfo.com', 'video-caps.puui.qpic.cn'].includes(base.hostname) || base.pathname !== '/0/') continue;
      choices.push({ baseUrl: base.href, link, name: item.fn, interval, columns, rows, width, height, duration });
    } catch { /* Ignore an invalid image host. */ }
  }
  // q2 is the player's 160px preview; prefer it over the larger poster sheet.
  return choices.sort((a, b) => Math.abs(a.width - 160) - Math.abs(b.width - 160))[0] || null;
}

export function normalizeTencentMetadata(raw: unknown, videoId: string): TencentSnapshot | null {
  const data = tencentRecord(raw);
  if (data.em !== undefined && Number(data.em) !== 0) return null;
  const videos = tencentRecord(data.vl).vi;
  const video = Array.isArray(videos) ? videos.map(tencentRecord).find((v) => v.vid === videoId) : null;
  if (!video) return null;
  const duration = Number(video.td);
  const previews = Array.isArray(video.pl) ? tencentRecord(video.pl[0]).pd : [];
  return {
    videoId, title: sanitizeContentTitle(video.ti) || undefined,
    duration: duration > 0 && duration <= 86400 ? duration : undefined,
    captionTracks: parseTencentCaptions(tencentRecord(data.sfl).fi, videoId),
    storyboard: parseTencentStoryboard(previews, video.lnk, duration)
  };
}

export function tencentPreviewFrame(storyboard: TencentStoryboard, time: number): PreviewFrame | null {
  if (!Number.isFinite(time)) return null;
  const { duration, interval, columns, rows, width, height } = storyboard;
  const last = Math.max(0, Math.ceil(duration / interval) - 1);
  const tile = Math.min(last, Math.max(0, Math.floor(time / interval)));
  const sheet = Math.floor(tile / (columns * rows));
  const within = tile % (columns * rows);
  return {
    time: tile * interval, width, height,
    image: { kind: 'sprite', url: `${storyboard.baseUrl}${storyboard.link}.${storyboard.name}.${sheet + 1}.jpg/0`,
      x: (within % columns) * width, y: Math.floor(within / columns) * height,
      tileWidth: width, tileHeight: height, sheetWidth: columns * width, sheetHeight: rows * height }
  };
}
