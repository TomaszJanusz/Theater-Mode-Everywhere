import type { WatchPlayback } from '../watch-playback';

type VimeoWatchWindow = Window & {
  playerConfig?: { video?: { id?: unknown; clip_id?: unknown } };
  _player_config?: { video?: { id?: unknown; clip_id?: unknown } };
  next?: { router?: { query?: { clipId?: unknown } } };
};

/**
 * Embeds still publish `playerConfig`. vimeo.com clip pages are a Next.js app without one: the
 * router's `clipId` is the live identity there, because `__NEXT_DATA__` stays on the first clip
 * after client navigation. The player is rebuilt per clip, so it is not a stale one's to confirm.
 */
function hostClipId(view: VimeoWatchWindow | null): string | null {
  const config = view?.playerConfig ?? view?._player_config;
  const id = config?.video?.id ?? config?.video?.clip_id ?? view?.next?.router?.query?.clipId;
  return typeof id === 'string' || typeof id === 'number' ? String(id) : null;
}

export function vimeoWatchPageId(url: URL): string | null {
  const path = url.hostname === 'player.vimeo.com'
    ? /^\/video\/(\d+)(?:\/)?$/
    : /^\/(\d+)(?:\/[a-f0-9]+)?\/?$/;
  return path.exec(url.pathname)?.[1] ?? null;
}

export const vimeoWatchPlayback: WatchPlayback = {
  pageIdentity: vimeoWatchPageId,
  mainVideo(doc, identity) {
    if (hostClipId(doc.defaultView as VimeoWatchWindow | null) !== identity) return null;
    // Ordinary Vimeo clips have no inserted ads; showcases, OTT and live pages
    // are deliberately not declared. Embedded watch-page players stay ineligible.
    const videos = doc.querySelectorAll<HTMLVideoElement>('.player video');
    return videos.length === 1 ? videos[0] : null;
  }
};
