/** Stable content identities exclude unrelated tracking, time and playlist parameters. */
export function youtubeWatchPageId(url: URL): string | null {
  const id = url.searchParams.get('v');
  return url.pathname === '/watch' && id && /^[\w-]{11}$/.test(id) ? id : null;
}
