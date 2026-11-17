import { parsePlaylistSnapshot, type PlaylistPanelSnapshot } from '../../core/playlist-panel';

export const YOUTUBE_PLAYLIST_QUERY = 'theater-everywhere-youtube-playlist-query';
export const YOUTUBE_PLAYLIST_GO = 'theater-everywhere-youtube-playlist-go';
export const YOUTUBE_PLAYLIST_REPLY = 'theater-everywhere-youtube-playlist';

/** What MAIN publishes for one query: the snapshot of the page it read, or null when it has no list. */
export type YouTubePlaylistReply = { requestId: string; pageHref: string; snapshot: PlaylistPanelSnapshot | null };

/** A few hundred rows of titles, bylines and thumbnail URLs; anything larger is not a panel list. */
const MAX_REPLY_CHARS = 2_000_000;
let requestCounter = 0;

/**
 * Strings cross Firefox's MAIN/isolated-world boundary without object access errors. MAIN answers synchronously
 * inside the dispatch; a reply for another request or another page is dropped, and the reply node is removed once
 * read so a long list does not stay in the page.
 */
export function queryYouTubePlaylist(doc: Document): PlaylistPanelSnapshot | null {
  const view = doc.defaultView;
  if (!view) return null;
  const requestId = `${Date.now()}:${++requestCounter}`;
  view.dispatchEvent(new CustomEvent(YOUTUBE_PLAYLIST_QUERY, { detail: requestId }));
  const node = doc.getElementById(YOUTUBE_PLAYLIST_REPLY);
  const text = node?.textContent;
  node?.remove();
  if (!text || text.length > MAX_REPLY_CHARS) return null;
  try {
    const reply = JSON.parse(text) as Partial<YouTubePlaylistReply> | null;
    if (!reply || reply.requestId !== requestId || reply.pageHref !== view.location.href) return null;
    return parsePlaylistSnapshot(reply.snapshot);
  } catch {
    return null;
  }
}

/** MAIN resolves the key against the live list again; a stale key does nothing. */
export function goToYouTubePlaylistItem(doc: Document, key: string): void {
  doc.defaultView?.dispatchEvent(new CustomEvent(YOUTUBE_PLAYLIST_GO, { detail: key }));
}
