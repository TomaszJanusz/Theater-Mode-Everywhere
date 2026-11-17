import type { PlaylistPanelItem, PlaylistPanelSnapshot } from '../../core/playlist-panel';
import { mediaProviderIntegrationEnabled } from '../../media-features/provider-flags';
import { publishHiddenJson } from '../../platform/hidden-json';
import { isYouTubeHost } from '../hosts';

import { currentEntryIndex, findWatchPlaylist, integer, readWatchPlaylistEntries, runsText, string } from './playlist-host';
import { YOUTUBE_PLAYLIST_GO, YOUTUBE_PLAYLIST_QUERY, YOUTUBE_PLAYLIST_REPLY, type YouTubePlaylistReply } from './playlist-panel-bridge';

type Resolution = { snapshot: PlaylistPanelSnapshot; targets: Map<string, () => void> };

let installed = false;

/** Answers the isolated playlist panel on demand; nothing observes or polls here. */
export function installYouTubePlaylist(): void {
  if (installed || !isYouTubeHost()) return;
  installed = true;
  window.addEventListener(YOUTUBE_PLAYLIST_QUERY, (event: Event) => {
    const requestId = (event as CustomEvent<unknown>).detail;
    if (typeof requestId !== 'string' || requestId.length > 80) return;
    const resolved = safelyResolve();
    const reply: YouTubePlaylistReply = { requestId, pageHref: window.location.href, snapshot: resolved?.snapshot ?? null };
    publishHiddenJson(YOUTUBE_PLAYLIST_REPLY, reply);
  });
  window.addEventListener(YOUTUBE_PLAYLIST_GO, (event: Event) => {
    const key = (event as CustomEvent<unknown>).detail;
    if (typeof key !== 'string' || key.length > 4000) return;
    // Re-read the model: a key from an earlier list or page finds no target.
    const activate = safelyResolve()?.targets.get(key);
    try { activate?.(); } catch { /* Host navigation may disappear mid-click. */ }
  });
}

function safelyResolve(): Resolution | null {
  try {
    return mediaProviderIntegrationEnabled('youtube') ? resolvePlaylist() : null;
  } catch {
    // Host properties can throw or disappear during SPA navigation.
    return null;
  }
}

function resolvePlaylist(): Resolution | null {
  const playlist = findWatchPlaylist();
  if (!playlist) return null;
  const entries = readWatchPlaylistEntries(playlist);
  const current = currentEntryIndex(entries, playlist);
  const targets = new Map<string, () => void>();
  const items: PlaylistPanelItem[] = [];
  entries.forEach((entry, index) => {
    if (!entry?.title) return;
    // The list, the occurrence and the video: a key cannot select a different item after the list changes.
    const key = JSON.stringify([playlist.queueId, entry.identity, entry.id]);
    const isCurrent = index === current;
    if (entry.activate && !isCurrent) targets.set(key, entry.activate);
    items.push({
      key, title: entry.title, position: entry.position, byline: entry.byline, duration: entry.duration,
      imageUrl: entry.thumbnail, current: isCurrent, playable: isCurrent || Boolean(entry.activate)
    });
  });
  if (!items.length) return null;
  const data = playlist.data;
  const snapshot: PlaylistPanelSnapshot = {
    title: runsText(data.titleText) || string(data.title),
    owner: runsText(data.ownerName) || runsText(data.shortBylineText),
    // Mixes are endless and give no count.
    total: data.isInfinite === true ? null : integer(data.totalVideos),
    items
  };
  return { snapshot, targets };
}
