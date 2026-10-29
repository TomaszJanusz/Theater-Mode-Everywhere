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

/** Twitch VOD pages only: `/videos/<id>`. Live channels, clips and `?video=` embeds stay manual. */
export function twitchVodId(url: URL): string | null {
  if (url.hostname !== 'www.twitch.tv' && url.hostname !== 'twitch.tv') return null;
  return /^\/videos\/(\d+)\/?$/.exec(url.pathname)?.[1] ?? null;
}
