import { mediaProviderIntegrationEnabled } from '../../media-features/provider-flags';
import type { PlaylistDirection } from '../../playlist-nav';
import { publishHiddenJson } from '../../platform/hidden-json';
import { isYouTubeHost } from '../hosts';
import { currentEntryIndex, findWatchPlaylist, integer, readWatchPlaylistEntries, type QueueEntry } from './playlist-host';
import {
  YOUTUBE_QUEUE_GO,
  YOUTUBE_QUEUE_QUERY,
  YOUTUBE_QUEUE_SNAPSHOT,
  type YouTubeQueueSnapshot,
  type YouTubeQueueStep
} from './queue-bridge';

type Resolution = {
  snapshot: Omit<YouTubeQueueSnapshot, 'requestId'>;
  targets: Partial<Record<PlaylistDirection, () => void>>;
};

let installed = false;

/** Read on demand through the existing controls refresh; no page-wide observer or timer. */
export function installYouTubeQueueNavigation(): void {
  if (installed || !isYouTubeHost()) return;
  installed = true;
  window.addEventListener(YOUTUBE_QUEUE_QUERY, (event: Event) => {
    const requestId = (event as CustomEvent<unknown>).detail;
    if (typeof requestId !== 'string' || requestId.length > 80) return;
    const resolved = safelyResolveQueue();
    publishHiddenJson(YOUTUBE_QUEUE_SNAPSHOT, resolved ? { ...resolved.snapshot, requestId } : null);
  });
  window.addEventListener(YOUTUBE_QUEUE_GO, (event: Event) => {
    const key = (event as CustomEvent<unknown>).detail;
    if (typeof key !== 'string' || key.length > 4000) return;
    // Re-read the model and native command. A saved action cannot select a new neighbor.
    const resolved = safelyResolveQueue();
    if (!resolved) return;
    for (const direction of ['previous', 'next'] as const) {
      const step = resolved.snapshot[direction];
      const activate = resolved.targets[direction];
      if (step.kind === 'item' && step.key === key && activate) {
        try { activate(); } catch { /* Host navigation may disappear mid-click. */ }
        return;
      }
    }
  });
}

function safelyResolveQueue(): Resolution | null {
  try {
    return mediaProviderIntegrationEnabled('youtube') ? resolveQueue() : null;
  } catch {
    // Host properties can throw or disappear during SPA navigation.
    return null;
  }
}

function resolveQueue(): Resolution | null {
  const playlist = findWatchPlaylist();
  if (!playlist) return null;
  const { url, player, videoId, data, queueId } = playlist;
  const entries = readWatchPlaylistEntries(playlist);
  const matching = entries.flatMap((entry, index) => entry?.id === videoId ? [index] : []);
  const current = currentEntryIndex(entries, playlist);
  const currentEntry = entries[current];
  if (!currentEntry) return null;

  const sequence = player.getPlaylist?.();
  const sequenceIndex = integer(player.getPlaylistIndex?.());
  const playerQueueId = player.getPlaylistId?.();
  const trustedSequence = Array.isArray(sequence) && sequence.every(id => typeof id === 'string')
    && sequenceIndex != null && sequence[sequenceIndex] === videoId && playerQueueId === queueId;
  // A newly created session queue prepends a linkless current-video placeholder.
  // Its selected row can already be the first *upcoming* item, with endpoint index 0.
  const pendingQueue = queueId.startsWith('TL') && current === 0 && currentEntry.placeholder
    && matching.length === 1 && integer(data.currentIndex) === 0;
  const sameOrder = trustedSequence && sequence.length === entries.length
    && entries.every((entry, index) => entry?.id === sequence[index]);
  if (sameOrder && sequenceIndex !== current) return null;
  const complete = trustedSequence && data.isInfinite === false
    && integer(data.totalVideos) === sequence.length && entries.every(Boolean)
    && entries.length === sequence.length;
  const targets: Resolution['targets'] = {};
  const snapshot: Resolution['snapshot'] = {
    pageHref: url.href, videoId, previous: { kind: 'unknown' }, next: { kind: 'unknown' }
  };
  for (const direction of ['previous', 'next'] as const) {
    const offset = direction === 'next' ? 1 : -1;
    let target: QueueEntry | null = null;
    let boundary = false;
    if (pendingQueue) {
      target = direction === 'next' ? entries[1] : null;
      // There is no prior queue item before this linkless playback placeholder.
      // YouTube can misleadingly preview the upcoming item on Previous here.
      boundary = direction === 'previous';
    } else if (trustedSequence) {
      const targetId = (sequence as string[])[sequenceIndex! + offset];
      if (typeof targetId === 'string') {
        const candidates = entries.filter((entry): entry is QueueEntry => entry?.id === targetId);
        target = sameOrder ? entries[sequenceIndex! + offset] : candidates.length === 1 ? candidates[0] : null;
      } else {
        // Preserve offered wrapping/repeat at the edges without guessing loop state.
        const nativeId = nativePreviewId(player, direction);
        const candidates = entries.filter((entry): entry is QueueEntry => entry?.id === nativeId);
        target = nativeId !== videoId && candidates.length === 1 ? candidates[0] : null;
        // A recommendation outside a complete finite queue is a confirmed end.
        boundary = direction === 'next' && complete && Boolean(nativeId) && candidates.length === 0;
      }
    } else if (!nativeStepUsable(player, direction)) {
      // The player can hide both steps while this panel still lists the queue.
      // A visible player step keeps its own target, including shuffle and restart.
      const neighbor = entries[current + offset];
      if (neighbor?.activate) target = neighbor;
    }
    if (target?.activate) {
      const key = JSON.stringify([queueId, videoId, currentEntry.identity, direction, target.id, target.identity]);
      const step: YouTubeQueueStep = { kind: 'item', key, title: target.title, imageUrl: target.imageUrl };
      snapshot[direction] = step;
      targets[direction] = target.activate;
    } else if (boundary) {
      snapshot[direction] = { kind: 'boundary' };
    }
  }
  return { snapshot, targets };
}

function nativeStepUsable(player: HTMLElement, direction: PlaylistDirection): boolean {
  const button = player.querySelector(direction === 'next' ? '.ytp-next-button' : '.ytp-prev-button');
  if (!(button instanceof HTMLElement)) return false;
  if (button.hasAttribute('disabled') || button.getAttribute('aria-disabled') === 'true') return false;
  if (button.style.display === 'none') return false;
  try {
    return getComputedStyle(button).display !== 'none';
  } catch {
    return true;
  }
}

function nativePreviewId(player: HTMLElement, direction: PlaylistDirection): string {
  const image = player.querySelector(direction === 'next' ? '.ytp-next-button' : '.ytp-prev-button')?.getAttribute('data-preview');
  if (!image) return '';
  try {
    const url = new URL(image);
    if (!/^(?:i\d*\.)?ytimg\.com$/.test(url.hostname)) return '';
    return url.pathname.match(/^\/vi(?:_webp)?\/([^/]+)\//)?.[1] || '';
  } catch {
    return '';
  }
}
