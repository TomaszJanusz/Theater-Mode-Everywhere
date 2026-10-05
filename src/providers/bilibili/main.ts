import { isBilibiliHost } from '../hosts';
import { mediaProviderIntegrationEnabled } from '../../media-features/provider-flags';
import { normalizeBilibiliSnapshot, type BilibiliSnapshot } from '../../media-features/parsers/bilibili';

export function bilibiliIntegrationEnabled(): boolean {
  return isBilibiliHost() && mediaProviderIntegrationEnabled('bilibili');
}

let cached: { key: string; expires: number; pending: Promise<BilibiliSnapshot | null> } | null = null;

async function metadata(path: string, aid: number, cid: number): Promise<unknown> {
  try {
    // Only player metadata, requested in the page's existing login context.
    const response = await fetch(`https://api.bilibili.com/x/player/${path}?aid=${aid}&cid=${cid}&index=1`, {
      credentials: 'include', signal: AbortSignal.timeout(2500)
    });
    if (!response.ok || (response.url && new URL(response.url).origin !== 'https://api.bilibili.com')) return null;
    const body = await response.text();
    if (body.length > 2 * 1024 * 1024) return null;
    const json = JSON.parse(body);
    return json.code === 0 ? json.data : null;
  } catch {
    return null;
  }
}

async function readPbp(aid: number, cid: number): Promise<unknown> {
  try {
    // The loader endpoint allows any origin and rejects credentialed requests.
    const response = await fetch(`https://bvc.bilivideo.com/pbp/data?aid=${aid}&cid=${cid}&r=loader`, {
      credentials: 'omit', signal: AbortSignal.timeout(2500)
    });
    if (!response.ok || (response.url && new URL(response.url).hostname !== 'bvc.bilivideo.com')) return null;
    const body = await response.text();
    if (body.length > 512 * 1024) return null;
    return JSON.parse(body);
  } catch {
    return null;
  }
}

async function readSubtitleView(aid: number, cid: number): Promise<Uint8Array | null> {
  try {
    const response = await fetch(
      `https://api.bilibili.com/x/v2/subtitle/web/view?oid=${cid}&pid=${aid}&type=1`,
      { credentials: 'include', signal: AbortSignal.timeout(2500) }
    );
    if (!response.ok || (response.url && new URL(response.url).origin !== 'https://api.bilibili.com')) return null;
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength === 0 || buffer.byteLength > 256 * 1024) return null;
    return new Uint8Array(buffer);
  } catch {
    return null;
  }
}

export async function readBilibiliSnapshot(): Promise<BilibiliSnapshot | null> {
  if (!bilibiliIntegrationEnabled()) { cached = null; return null; }
  const win = window as Window & { __INITIAL_STATE__?: Record<string, any> };
  const state = win.__INITIAL_STATE__ || {};
  const video = state.videoData || state.epInfo || {};
  const cid = Number(state.cid || video.cid);
  const aid = Number(state.aid || video.aid);
  if (!Number.isSafeInteger(cid) || cid <= 0 || !Number.isSafeInteger(aid) || aid <= 0) return null;
  const key = `${aid}:${cid}`;
  if (cached?.key === key && cached.expires > Date.now()) return cached.pending;
  const page = Array.isArray(video.pages) ? video.pages.find((p: Record<string, unknown>) => Number(p.cid) === cid) : null;
  const title = video.title || video.long_title || document.querySelector('h1')?.textContent;
  const duration = Number(page?.duration || video.duration);
  const pending = Promise.all([
    metadata('v2', aid, cid), metadata('videoshot', aid, cid), readPbp(aid, cid), readSubtitleView(aid, cid)
  ]).then(([info, shot, pbp, subtitles]) => {
    // Ignore a late response after a SPA episode change or RTE has been disabled.
    const current = win.__INITIAL_STATE__ || {};
    if (!bilibiliIntegrationEnabled() || Number(current.cid || current.videoData?.cid || current.epInfo?.cid) !== cid) return null;
    return normalizeBilibiliSnapshot(key, title, duration, info, shot, pbp, subtitles);
  });
  cached = { key, expires: Date.now() + 15000, pending };
  return pending;
}
