import type { WatchPlayback } from '../watch-playback';

type VimeoWatchWindow = Window & {
  playerConfig?: { video?: { id?: unknown; clip_id?: unknown } };
  _player_config?: { video?: { id?: unknown; clip_id?: unknown } };
};

export function vimeoWatchPageId(url: URL): string | null {
  const path = url.hostname === 'player.vimeo.com'
    ? /^\/video\/(\d+)(?:\/)?$/
    : /^\/(\d+)(?:\/[a-f0-9]+)?\/?$/;
  return path.exec(url.pathname)?.[1] ?? null;
}

export const vimeoWatchPlayback: WatchPlayback = {
  pageIdentity: vimeoWatchPageId,
  mainVideo(doc, identity) {
    const view = doc.defaultView as VimeoWatchWindow | null;
    const config = view?.playerConfig ?? view?._player_config;
    const id = config?.video?.id ?? config?.video?.clip_id;
    if ((typeof id !== 'string' && typeof id !== 'number') || String(id) !== identity) return null;
    // Ordinary Vimeo clips have no inserted ads; showcases, OTT and live pages
    // are deliberately not declared. Embedded watch-page players stay ineligible.
    const videos = doc.querySelectorAll<HTMLVideoElement>('.player video');
    return videos.length === 1 ? videos[0] : null;
  }
};
