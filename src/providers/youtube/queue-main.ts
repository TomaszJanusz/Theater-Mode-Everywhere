import { mediaProviderIntegrationEnabled } from '../../media-features/provider-flags';
import type { PlaylistDirection } from '../../playlist-nav';
import { publishHiddenJson } from '../../platform/hidden-json';
import { isYouTubeHost } from '../hosts';
import {
  YOUTUBE_QUEUE_GO,
  YOUTUBE_QUEUE_QUERY,
  YOUTUBE_QUEUE_SNAPSHOT,
  type YouTubeQueueSnapshot,
  type YouTubeQueueStep
} from './queue-bridge';

type RecordValue = Record<string, unknown>;
type HostNode = HTMLElement & { data?: unknown; polymerController?: { data?: unknown } };
type QueuePlayer = HTMLElement & {
  getVideoData?: () => { video_id?: unknown };
  getPlaylist?: () => unknown;
  getPlaylistIndex?: () => unknown;
  getPlaylistId?: () => unknown;
};
type QueueEntry = {
  id: string;
  identity: string;
  selected: boolean;
  placeholder: boolean;
  anchor: HTMLAnchorElement | null;
  title: string;
  imageUrl: string;
};
type RowIndex = { byData: Map<unknown, HostNode[]>; byIdentity: Map<string, HostNode[]> };
type Resolution = {
  snapshot: Omit<YouTubeQueueSnapshot, 'requestId'>;
  targets: Partial<Record<PlaylistDirection, HTMLAnchorElement>>;
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
    // Re-read both the model and live row. A saved action cannot click a new neighbor.
    const resolved = safelyResolveQueue();
    if (!resolved) return;
    for (const direction of ['previous', 'next'] as const) {
      const step = resolved.snapshot[direction];
      const anchor = resolved.targets[direction];
      if (step.kind === 'item' && step.key === key && anchor?.isConnected) {
        try { anchor.click(); } catch { /* Host navigation may disappear mid-click. */ }
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
  const url = new URL(window.location.href);
  if (url.pathname !== '/watch') return null;
  const player = document.getElementById('movie_player') as QueuePlayer | null;
  const videoId = player?.getVideoData?.().video_id;
  if (!player || typeof videoId !== 'string' || videoId !== url.searchParams.get('v')) return null;
  // Only the watch-page panel belongs to this player; miniplayer copies are unrelated.
  const watch = player.closest('ytd-watch-flexy');
  if (!watch || watch.hasAttribute('hidden')) return null;
  const panels = Array.from(watch.querySelectorAll<HostNode>('ytd-playlist-panel-renderer'))
    .filter(panel => !panel.closest('ytd-miniplayer'));
  if (panels.length !== 1) return null;
  const panel = panels[0];
  const data = record(panel.data ?? panel.polymerController?.data);
  const queueId = string(data.playlistId);
  const contents = data.contents;
  if (!queueId || !Array.isArray(contents) || !contents.length || contents.length > 5000) return null;
  const list = url.searchParams.get('list');
  if (list && list !== queueId) return null;
  const rows = indexRows(panel);
  const entries = contents.map((value, index) => readEntry(record(value).playlistPanelVideoRenderer, index, rows, queueId));
  const matching = entries.flatMap((entry, index) => entry?.id === videoId ? [index] : []);
  const selected = matching.filter(index => entries[index]?.selected);
  const localIndex = integer(data.localCurrentIndex);
  const current = selected.length === 1 ? selected[0]
    : matching.length === 1 ? matching[0]
    : localIndex != null && matching.includes(localIndex) ? localIndex : -1;
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
  if (!trustedSequence && !pendingQueue) return null;
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
    } else {
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
    }
    if (target?.anchor) {
      const key = JSON.stringify([queueId, videoId, currentEntry.identity, direction, target.id, target.identity]);
      const step: YouTubeQueueStep = { kind: 'item', key, title: target.title, imageUrl: target.imageUrl };
      snapshot[direction] = step;
      targets[direction] = target.anchor;
    } else if (boundary) {
      snapshot[direction] = { kind: 'boundary' };
    }
  }
  return { snapshot, targets };
}

function readEntry(raw: unknown, index: number, rows: RowIndex, queueId: string): QueueEntry | null {
  const data = record(raw);
  const id = string(data.videoId);
  if (!id) return null;
  const endpoint = record(record(data.navigationEndpoint).watchEndpoint);
  const identity = string(data.playlistSetVideoId) || JSON.stringify([index, id, endpoint.index]);
  const candidates = rows.byData.get(data) ?? rows.byIdentity.get(rowIdentity(data)) ?? [];
  const row = candidates.length === 1 ? candidates[0] : null;
  const anchor = row?.querySelector<HTMLAnchorElement>('a#wc-endpoint, a[href]') ?? null;
  let usableAnchor: HTMLAnchorElement | null = null;
  if (anchor && data.isPlayable !== false && !data.unplayableText && !row?.hasAttribute('disabled')) {
    const url = new URL(anchor.href, window.location.href);
    const endpointIndex = integer(endpoint.index);
    if (url.origin === window.location.origin && url.pathname === '/watch'
      && url.searchParams.get('v') === id && url.searchParams.get('list') === queueId
      && (endpointIndex == null || Number(url.searchParams.get('index')) === endpointIndex + 1)
      && anchor.getAttribute('aria-disabled') !== 'true') usableAnchor = anchor;
  }
  const titleData = record(data.title);
  const title = (string(titleData.simpleText) || (Array.isArray(titleData.runs)
    ? titleData.runs.map(run => string(record(run).text)).join('') : '')).replace(/\s+/g, ' ').trim();
  const images = record(data.thumbnail).thumbnails;
  const imageUrl = Array.isArray(images) ? string(record(images[images.length - 1]).url) : '';
  return {
    id, identity, selected: data.selected === true, anchor: usableAnchor,
    placeholder: !endpoint.videoId && !anchor?.getAttribute('href'),
    title: title.length <= 180 ? title : '', imageUrl: imageUrl.length <= 2000 ? imageUrl : ''
  };
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

function indexRows(panel: HTMLElement): RowIndex {
  const byData: RowIndex['byData'] = new Map();
  const byIdentity: RowIndex['byIdentity'] = new Map();
  for (const row of panel.querySelectorAll<HostNode>('ytd-playlist-panel-video-renderer')) {
    const data = record(row.data ?? row.polymerController?.data);
    const identity = rowIdentity(data);
    const dataRows = byData.get(data);
    if (dataRows) dataRows.push(row);
    else byData.set(data, [row]);
    const identityRows = byIdentity.get(identity);
    if (identityRows) identityRows.push(row);
    else byIdentity.set(identity, [row]);
  }
  return { byData, byIdentity };
}

function rowIdentity(data: RecordValue): string {
  return string(data.playlistSetVideoId)
    || JSON.stringify([data.videoId, record(record(data.navigationEndpoint).watchEndpoint).index]);
}

function record(value: unknown): RecordValue {
  return value && typeof value === 'object' ? value as RecordValue : {};
}

function string(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function integer(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
