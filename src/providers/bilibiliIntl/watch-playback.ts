import type { WatchPlayback } from '../watch-playback';

import { INTL_NAVIGATE_EVENT } from './history';
import { BILIBILI_INTL_PLAYER_SELECTOR } from './navigation';

/** Locale and tracking changes do not create another visit to the same content. */
export function bilibiliIntlVideoIdentity(url: URL): string | null {
  if (url.protocol !== 'https:' || url.hostname !== 'www.bilibili.tv') return null;
  const match = /^\/[a-z]{2}(?:-[A-Za-z0-9]{2,8})?\/(?:video\/([1-9]\d{0,19})|play\/([1-9]\d{0,19})\/([1-9]\d{0,19}))\/?$/.exec(url.pathname);
  return match ? match[1] ? `ugc:${match[1]}` : `ogv:${match[2]}:${match[3]}` : null;
}

type DashPlayer = {
  video?: unknown;
  state?: { manifest?: { originalUrl?: unknown; type?: unknown } };
};

function contentVideo(doc: Document, identity: string): HTMLVideoElement | null {
  try {
    const dash = (doc.defaultView as (Window & { dashPlayer?: DashPlayer }) | null)?.dashPlayer;
    const manifest = dash?.state?.manifest;
    // The live DASH manifest snapshots the route when this stream is created. Page
    // state and the URL alone can already describe the next video during SPA navigation.
    if (manifest?.type !== 'static' || typeof manifest.originalUrl !== 'string'
      || bilibiliIntlVideoIdentity(new URL(manifest.originalUrl)) !== identity) return null;
    const roots = doc.querySelectorAll(`${BILIBILI_INTL_PLAYER_SELECTOR} #bilibiliPlayer`);
    const root = roots.length === 1 ? roots[0] : null;
    if (!root?.matches('[data-ui-mode="0"], [data-ui-mode="1"]')) return null;
    const videos = root.querySelectorAll('.player-mobile-video-wrap > video');
    const video = videos.length === 1 ? videos[0] : null;
    if (!(video instanceof HTMLVideoElement) || dash?.video !== video || video.duration === Infinity) return null;
    // In-stream ads have their own surface; the host hides it explicitly after
    // completion. Unknown visibility fails closed, including ad loading.
    const ad = root.querySelector<HTMLElement>('.player-mobile-ad-container');
    if (ad && ad.style.display !== 'none') return null;
    return video;
  } catch {
    return null;
  }
}

export const bilibiliIntlWatchPlayback: WatchPlayback = {
  pageIdentity: bilibiliIntlVideoIdentity,
  playbackPage(url) {
    // Season routes still host manual playback; only automatic entry needs an episode id.
    if (url.protocol !== 'https:' || url.hostname !== 'www.bilibili.tv') return false;
    const path = url.pathname.replace(/^\/[a-z]{2}(?:-[A-Za-z0-9]{2,8})?(?=\/)/, '');
    return /^\/(?:video\/[1-9]\d{0,19}|play\/[1-9]\d{0,19}(?:\/[1-9]\d{0,19})?)\/?$/.test(path);
  },
  mainVideo: contentVideo,
  preparingVideo: contentVideo,
  refreshEvents: [INTL_NAVIGATE_EVENT, 'popstate'],
  observe(video, onChange) {
    const root = video.closest('#bilibiliPlayer');
    if (!root) return null;
    const observer = new MutationObserver(onChange);
    observer.observe(root, { attributes: true, attributeFilter: ['data-ui-mode'] });
    const wrap = video.parentElement;
    if (wrap) observer.observe(wrap, { childList: true });
    const ad = root.querySelector('.player-mobile-ad-container');
    if (ad) observer.observe(ad, { attributes: true, attributeFilter: ['style'] });
    return () => observer.disconnect();
  }
};
