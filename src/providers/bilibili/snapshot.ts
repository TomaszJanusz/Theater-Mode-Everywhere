import { mediaProviderIntegrationEnabled } from '../../media-features/provider-flags';
import { createPageVisits, untilAborted } from '../page-visits';

import { BILIBILI_NAVIGATE_EVENT } from './history';
import { isBilibiliHost } from './hosts';
import { normalizeBilibiliSnapshot, type BilibiliSnapshot } from './metadata';
import { signBilibiliWbi } from './wbi';

function integrationEnabled(): boolean {
  return isBilibiliHost() && mediaProviderIntegrationEnabled('bilibili');
}

let cached: { key: string; visit: object; expires: number; pending: Promise<BilibiliSnapshot | null> } | null = null;

/** A visit is one video part: tracking parameters and timestamps do not start another. */
const visits = createPageVisits(() => `${window.location.pathname}?p=${new URLSearchParams(window.location.search).get('p') ?? ''}`);

/** Installed with the history hook: route changes to another video or part start a new visit. */
export function trackBilibiliVisits(): void {
  for (const event of [BILIBILI_NAVIGATE_EVENT, 'popstate', 'hashchange']) window.addEventListener(event, visits.note);
  window.addEventListener('pagehide', visits.end);
}

async function metadata(path: string, aid: number, cid: number): Promise<unknown> {
  try {
    // Only player metadata, requested in the page's existing login context.
    const response = await fetch(`https://api.bilibili.com/x/player/${path}?aid=${aid}&cid=${cid}&index=1`, {
      credentials: 'include', signal: visits.signal(2500)
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
      credentials: 'omit', signal: visits.signal(2500)
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
    const query = signBilibiliWbi({ oid: cid, pid: aid, type: 1 });
    const response = await fetch(
      `https://api.bilibili.com/x/v2/subtitle/web/view?${query}`,
      { credentials: 'include', signal: visits.signal(5000) }
    );
    if (!response.ok || (response.url && new URL(response.url).origin !== 'https://api.bilibili.com')) return null;
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength === 0 || buffer.byteLength > 256 * 1024) return null;
    return new Uint8Array(buffer);
  } catch {
    return null;
  }
}

/** The part's snapshot, shared by requests within one visit; `signal` releases only this request. */
export function readBilibiliSnapshot(signal?: AbortSignal): Promise<BilibiliSnapshot | null> {
  return untilAborted(readSnapshot(), signal);
}

async function readSnapshot(): Promise<BilibiliSnapshot | null> {
  if (!integrationEnabled()) { cached = null; return null; }
  const win = window as Window & { __INITIAL_STATE__?: Record<string, any> };
  const state = win.__INITIAL_STATE__ || {};
  const video = state.videoData || state.epInfo || {};
  const cid = Number(state.cid || video.cid);
  const aid = Number(state.aid || video.aid);
  if (!Number.isSafeInteger(cid) || cid <= 0 || !Number.isSafeInteger(aid) || aid <= 0) return null;
  const key = `${aid}:${cid}`;
  const visit = visits.current();
  if (cached?.key === key && cached.visit === visit && cached.expires > Date.now()) return cached.pending;
  const page = Array.isArray(video.pages) ? video.pages.find((p: Record<string, unknown>) => Number(p.cid) === cid) : null;
  const title = video.title || video.long_title || document.querySelector('h1')?.textContent;
  const duration = Number(page?.duration || video.duration);
  const pending = Promise.all([
    metadata('v2', aid, cid), metadata('videoshot', aid, cid), readPbp(aid, cid), readSubtitleView(aid, cid)
  ]).then(([info, shot, pbp, subtitles]) => {
    // Ignore a late response after a SPA episode change, a later visit or RTE has been disabled.
    const current = win.__INITIAL_STATE__ || {};
    if (!integrationEnabled() || visits.current() !== visit || Number(current.cid || current.videoData?.cid || current.epInfo?.cid) !== cid) {
      if (cached?.pending === pending) cached = null;
      return null;
    }
    const snapshot = normalizeBilibiliSnapshot(key, title, duration, info, shot, pbp, subtitles);
    // An empty subtitle list is often a timed-out view, not proof the film has none.
    // Keep it briefly so the next probe can retry without hammering every duration event.
    if (cached?.pending === pending && snapshot.captionTracks.length === 0) {
      cached = { key, visit, expires: Date.now() + 2000, pending };
    }
    return snapshot;
  });
  cached = { key, visit, expires: Date.now() + 15000, pending };
  return pending;
}
