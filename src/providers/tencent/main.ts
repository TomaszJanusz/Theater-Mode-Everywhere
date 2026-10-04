import { sanitizeContentTitle } from '../../media-features/content-title';
import { MAX_CAPTION_BYTES } from '../../media-features/fetch-allowlist';
import { mediaProviderIntegrationEnabled } from '../../media-features/provider-flags';
import { normalizeTencentMetadata, tencentRecord, type TencentSnapshot } from '../../media-features/parsers/tencent';
import { isTencentHost } from '../hosts';

export type { TencentSnapshot } from '../../media-features/parsers/tencent';
let harvested: TencentSnapshot | null = null;
let metadataObserver: MutationObserver | null = null;
const JSONP_WRAPPED = Symbol('theater-tencent-jsonp');

export function tencentIntegrationEnabled(): boolean {
  return isTencentHost() && mediaProviderIntegrationEnabled('tencent');
}

export function tencentContentTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return sanitizeContentTitle(value
    .replace(/[_\s-]*(?:(?:电视剧|电影|动漫|综艺|纪录片|少儿)[_\s-]*)?高清完整版视频在线观看.*$/, '')
    .replace(/[_\s-]*腾讯视频.*$/, '')
    .replace(/\s+Watch (?:Free|HD).*?\|\s*WeTV.*$/i, '')
    .replace(/\s*[|_-]\s*WeTV.*$/i, ''));
}

function wetvPageInfo(): Record<string, unknown> {
  try {
    const next = tencentRecord((window as any).__NEXT_DATA__);
    const data = tencentRecord(tencentRecord(next.props).pageProps).data;
    const parsed = typeof data === 'string' && data.length <= MAX_CAPTION_BYTES ? JSON.parse(data) : data;
    return tencentRecord(tencentRecord(parsed).videoInfo);
  } catch { return {}; }
}

export function tencentPageVideoId(): string | null {
  const path = window.location.pathname || '';
  const pathId = path.match(/\/([a-z0-9]{11})\.html$/i)?.[1]
    || path.match(/\/play\/[^/]+\/([a-z0-9]{11})(?:-|\/|$)/i)?.[1];
  const queryId = new URLSearchParams(window.location.search || '').get('vid');
  const info = tencentRecord((window as any).VIDEO_INFO);
  const value = pathId || queryId || info.vid || wetvPageInfo().vid;
  return typeof value === 'string' && /^[a-z0-9]{11}$/i.test(value) ? value : null;
}

export function isTencentMetadataUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && ['h5vv.video.qq.com', 'h5vv6.video.qq.com', 'play.wetv.vip'].includes(url.hostname)
      && url.pathname === '/getvinfo';
  } catch { return false; }
}

export function harvestTencentData(url: string, data: unknown): void {
  if (!tencentIntegrationEnabled() || !isTencentMetadataUrl(url)) return;
  const id = tencentPageVideoId();
  const snapshot = id ? normalizeTencentMetadata(data, id) : null;
  if (snapshot) harvested = snapshot;
}

export function harvestTencentBody(url: string, body: string): void {
  if (!tencentIntegrationEnabled() || !isTencentMetadataUrl(url) || body.length > MAX_CAPTION_BYTES) return;
  try {
    const text = body.trim();
    // getvinfo can return JSONP; parse its JSON argument without executing it.
    const json = text.startsWith('{') ? text : text.match(/^[\w$]+\(\s*(\{[\s\S]*\})\s*\);?$/)?.[1];
    if (json) harvestTencentData(url, JSON.parse(json));
  } catch { /* Metadata parsing must not affect playback. */ }
}

export function captureTencentNetworkResponse(url: string, response: Response): void {
  if (!tencentIntegrationEnabled() || !isTencentMetadataUrl(url) || !response.ok) return;
  const length = Number(response.headers.get('content-length'));
  if (length > MAX_CAPTION_BYTES) return;
  void response.clone().text().then((body) => harvestTencentBody(url, body)).catch(() => {});
}

export function captureTencentJsonpScript(url: string): void {
  if (!isTencentHost() || !isTencentMetadataUrl(url)) return;
  const callback = new URL(url).searchParams.get('callback');
  if (!callback || !/^getinfo_callback_[a-z0-9_$]{1,60}$/i.test(callback)) return;
  const target = window as unknown as Record<string, unknown>;
  const original = target[callback];
  if (typeof original !== 'function' || (original as any)[JSONP_WRAPPED]) return;
  const wrapped = function(this: unknown, ...args: unknown[]) {
    try { harvestTencentData(url, args[0]); } catch { /* Preserve the host callback. */ }
    return original.apply(this, args);
  };
  Object.defineProperty(wrapped, JSONP_WRAPPED, { value: true });
  target[callback] = wrapped;
}

export function installTencentMain(): void {
  if (!isTencentHost() || metadataObserver) return;
  const inspect = (node: Node) => {
    if (!(node instanceof Element)) return;
    if (node instanceof HTMLScriptElement && node.src) captureTencentJsonpScript(node.src);
    node.querySelectorAll('script[src]').forEach((script) => captureTencentJsonpScript((script as HTMLScriptElement).src));
  };
  metadataObserver = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes') inspect(record.target);
      else record.addedNodes.forEach(inspect);
    }
  });
  metadataObserver.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
  document.querySelectorAll('script[src]').forEach((script) => captureTencentJsonpScript((script as HTMLScriptElement).src));
}

function readWetvPlayerSnapshot(videoId: string): TencentSnapshot | null {
  try {
    const player = (window as any).player;
    if (!player || player.vid !== videoId || typeof player.getApiBridge !== 'function') return null;
    const data = tencentRecord(player.getApiBridge()?.videoInfo?.parseData);
    const video = tencentRecord(data.vitem);
    if (video.vid !== videoId) return null;
    return normalizeTencentMetadata({
      sfl: { fi: data.subtitleList },
      vl: { vi: [{ vid: videoId, ti: data.title, td: data.duration, lnk: video.lnk, pl: [{ pd: data.previewList }] }] }
    }, videoId);
  } catch { return null; }
}

export function readTencentSnapshot(): TencentSnapshot | null {
  if (!tencentIntegrationEnabled()) { harvested = null; return null; }
  const videoId = tencentPageVideoId();
  if (!videoId) return null;
  const metadata = readWetvPlayerSnapshot(videoId) || (harvested?.videoId === videoId ? harvested : null);
  const info = tencentRecord((window as any).VIDEO_INFO);
  const title = tencentContentTitle(metadata?.title) || tencentContentTitle(wetvPageInfo().title)
    || (info.vid === videoId ? tencentContentTitle(info.title) : null) || tencentContentTitle(document.title);
  return { ...metadata, videoId, title: title || undefined,
    captionTracks: metadata?.captionTracks || [], storyboard: metadata?.storyboard || null };
}
