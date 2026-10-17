/** Stable content identities exclude unrelated tracking, time and playlist parameters. */
export function youtubeWatchPageId(url: URL): string | null {
  const id = url.searchParams.get('v');
  return url.pathname === '/watch' && id && /^[\w-]{11}$/.test(id) ? id : null;
}

export function vimeoWatchPageId(url: URL): string | null {
  const path = url.hostname === 'player.vimeo.com'
    ? /^\/video\/(\d+)(?:\/)?$/
    : /^\/(\d+)(?:\/[a-f0-9]+)?\/?$/;
  return path.exec(url.pathname)?.[1] ?? null;
}

/** Patreon post pages only: `/posts/<slug>-<id>` or `/<creator>/posts/<slug>-<id>`; feeds, creator pages and `/c/…` stay out. */
export function patreonPostId(url: URL): string | null {
  if (url.hostname !== 'www.patreon.com' && url.hostname !== 'patreon.com') return null;
  const match = /^(?:\/([^/]+))?\/posts\/(?:[^/]*-)?(\d+)\/?$/.exec(url.pathname);
  return match && match[1] !== 'c' ? match[2] : null;
}
