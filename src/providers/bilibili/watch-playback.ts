import type { WatchPlayback } from '../watch-playback';

import { BILIBILI_NAVIGATE_EVENT } from './history';

/**
 * Parts are separate visits; tracking parameters and timestamps are not. The site may prefix a
 * language route (`/zh-Hans/video/BV...`), which names the same video.
 */
export function bilibiliVideoIdentity(url: URL): string | null {
  if (url.protocol !== 'https:' || url.hostname !== 'www.bilibili.com') return null;
  const match = /^(?:\/[a-z]{2,3}(?:-[A-Za-z]{2,4})?)?\/video\/(BV[0-9A-Za-z]{10})\/?$/.exec(url.pathname);
  const part = url.searchParams.get('p') ?? '1';
  if (!match || !/^[1-9]\d*$/.test(part) || !Number.isSafeInteger(Number(part))) return null;
  return `${match[1]}:${Number(part)}`;
}

type BilibiliPlayer = {
  mediaElement?: () => unknown;
  hasValidAdv?: () => unknown;
  getManifest?: () => { bvid?: unknown; p?: unknown; cid?: unknown; kind?: unknown };
  getElements?: () => { container?: unknown };
};

function contentVideo(doc: Document, identity: string): HTMLVideoElement | null {
  const player = (doc.defaultView as (Window & { player?: BilibiliPlayer }) | null)?.player;
  try {
    // Patched ad playlists can reuse the content element and manifest. The public API
    // reports their presence, not which segment is active: keep the whole session manual.
    if (player?.hasValidAdv?.() !== false) return null;
    const manifest = player?.getManifest?.();
    // The live player's manifest, rather than __INITIAL_STATE__, follows SPA replacements.
    // kind 0 is an ordinary upload; never qualify bangumi/live or an uninitialized player.
    if (!manifest || manifest.kind !== 0 || `${manifest.bvid}:${manifest.p}` !== identity
      || typeof manifest.cid !== 'number' || !Number.isSafeInteger(manifest.cid) || manifest.cid <= 0) return null;
    const root = player?.getElements?.().container;
    if (!(root instanceof Element) || root.ownerDocument !== doc || !root.isConnected
      || !root.matches('.bpx-player-container[data-screen="normal"], .bpx-player-container[data-screen="wide"]')) return null;
    // Hover previews have separate surfaces. Confirm the API's actual media element
    // against the sole content video, never a document-wide first video or mini player.
    const videos = root.querySelectorAll('.bpx-player-primary-area .bpx-player-video-wrap > video');
    const video = videos.length === 1 ? videos[0] : null;
    return video instanceof HTMLVideoElement && player?.mediaElement?.() === video && video.duration !== Infinity ? video : null;
  } catch {
    return null;
  }
}

export const bilibiliWatchPlayback: WatchPlayback = {
  pageIdentity: bilibiliVideoIdentity,
  mainVideo: contentVideo,
  preparingVideo: contentVideo,
  refreshEvents: [BILIBILI_NAVIGATE_EVENT, 'popstate'],
  observe(video, onChange) {
    const root = video.closest('.bpx-player-container');
    if (!root) return null;
    const observer = new MutationObserver(onChange);
    observer.observe(root, { attributes: true, attributeFilter: ['data-screen'] });
    const wrap = video.parentElement;
    if (wrap) observer.observe(wrap, { childList: true });
    return () => observer.disconnect();
  }
};
