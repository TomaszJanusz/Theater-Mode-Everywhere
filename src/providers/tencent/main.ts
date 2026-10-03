import { sanitizeContentTitle } from '../../media-features/content-title';
import { mediaProviderIntegrationEnabled } from '../../media-features/provider-flags';
import { isTencentHost } from '../hosts';

export type TencentSnapshot = { videoId?: string; title?: string };

export function tencentIntegrationEnabled(): boolean {
  return isTencentHost() && mediaProviderIntegrationEnabled('tencent');
}

export function tencentContentTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return sanitizeContentTitle(value
    .replace(/[_\s-]*(?:(?:电视剧|电影|动漫|综艺|纪录片|少儿)[_\s-]*)?高清完整版视频在线观看.*$/, '')
    .replace(/[_\s-]*腾讯视频.*$/, ''));
}

export function readTencentSnapshot(): TencentSnapshot | null {
  if (!tencentIntegrationEnabled()) return null;
  const win = window as Window & { VIDEO_INFO?: { vid?: unknown; title?: unknown } };
  const info = win.VIDEO_INFO;
  const pathId = window.location.pathname.match(/\/([a-z0-9]+)\.html$/i)?.[1];
  const videoId = typeof info?.vid === 'string' ? info.vid.slice(0, 80) : pathId;
  // The live page's document title contains the episode; og:title adds marketing text.
  const title = tencentContentTitle(info?.title) || tencentContentTitle(document.title);
  return videoId ? { videoId, title: title || undefined } : null;
}
