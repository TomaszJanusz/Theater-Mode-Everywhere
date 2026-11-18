/**
 * MAIN-world reading of YouTube's own watch-page playlist panel (`ytd-playlist-panel-renderer`): its Polymer model
 * and rows, which only page script can see. Queue navigation and the playlist panel share it, so both name the same
 * list, current item and native activation.
 */

type RecordValue = Record<string, unknown>;
export type HostNode = HTMLElement & { data?: unknown; polymerController?: { data?: unknown } };
export type QueuePlayer = HTMLElement & {
  getVideoData?: () => { video_id?: unknown };
  getPlaylist?: () => unknown;
  getPlaylistIndex?: () => unknown;
  getPlaylistId?: () => unknown;
};
export type QueueEntry = {
  id: string;
  /** One occurrence of the video in the list; a video may occur twice. */
  identity: string;
  selected: boolean;
  placeholder: boolean;
  activate: (() => void) | null;
  title: string;
  /** The largest thumbnail, for step previews. */
  imageUrl: string;
  /** A row-sized ytimg thumbnail, for the playlist panel. */
  thumbnail: string;
  byline: string;
  duration: string;
  /**
   * The number YouTube shows on the row (1-based, in the whole list); null where it shows none: the playing row (▶) and
   * the queue's rows, whose endpoint indexes skip its first, link-less row.
   */
  position: number | null;
};
type RowIndex = { byData: Map<unknown, HostNode[]>; byIdentity: Map<string, HostNode[]> };

export type WatchPlaylist = {
  url: URL;
  player: QueuePlayer;
  videoId: string;
  panel: HostNode;
  data: RecordValue;
  queueId: string;
  contents: unknown[];
};

/** The panel model of the watch page's own player, when the URL, the player and the panel agree on the list. */
export function findWatchPlaylist(): WatchPlaylist | null {
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
  return { url, player, videoId, panel, data, queueId, contents };
}

/** Every model entry in list order, null where the model holds something other than a video (a continuation). */
export function readWatchPlaylistEntries(playlist: WatchPlaylist): Array<QueueEntry | null> {
  const rows = indexRows(playlist.panel);
  const context = { rows, queueId: playlist.queueId, panel: playlist.panel };
  return playlist.contents.map((value, index) => readEntry(playlistVideo(value), index, context));
}

/** The playing entry: the one row YouTube selected, else the one occurrence of the video, else the model's index. */
export function currentEntryIndex(entries: ReadonlyArray<QueueEntry | null>, playlist: WatchPlaylist): number {
  const matching = entries.flatMap((entry, index) => entry?.id === playlist.videoId ? [index] : []);
  const selected = matching.filter(index => entries[index]?.selected);
  const localIndex = integer(playlist.data.localCurrentIndex);
  if (selected.length === 1) return selected[0];
  if (matching.length === 1) return matching[0];
  return localIndex != null && matching.includes(localIndex) ? localIndex : -1;
}

function playlistVideo(value: unknown): unknown {
  const item = record(value);
  if (item.playlistPanelVideoRenderer) return item.playlistPanelVideoRenderer;
  const primary = record(record(item.playlistPanelVideoWrapperRenderer).primaryRenderer);
  return primary.playlistPanelVideoRenderer ?? null;
}

type EntryContext = { rows: RowIndex; queueId: string; panel: HTMLElement };

function readEntry(raw: unknown, index: number, context: EntryContext): QueueEntry | null {
  const data = record(raw);
  const id = string(data.videoId);
  if (!id) return null;
  const endpoint = record(record(data.navigationEndpoint).watchEndpoint);
  const candidates = context.rows.byData.get(data) ?? context.rows.byIdentity.get(rowIdentity(data)) ?? [];
  const row = candidates.length === 1 ? candidates[0] : null;
  const anchor = row?.querySelector<HTMLAnchorElement>('a#wc-endpoint, a[href]') ?? null;
  const title = runsText(data.title);
  const images = record(data.thumbnail).thumbnails;
  const imageUrl = Array.isArray(images) ? string(record(images[images.length - 1]).url) : '';
  const shownIndex = runsText(data.indexText);
  return {
    id,
    identity: string(data.playlistSetVideoId) || JSON.stringify([index, id, endpoint.index]),
    selected: data.selected === true,
    activate: entryActivation(data, { row, anchor, unique: candidates.length <= 1 }, context),
    placeholder: !endpoint.videoId && !anchor?.getAttribute('href'),
    title: title.length <= 180 ? title : '',
    imageUrl: imageUrl.length <= 2000 ? imageUrl : '',
    thumbnail: rowThumbnail(images),
    byline: runsText(data.shortBylineText) || runsText(data.longBylineText),
    duration: runsText(data.lengthText),
    position: /^\d{1,6}$/.test(shownIndex) ? Number(shownIndex) : null
  };
}

/** The row's own link, else YouTube's endpoint for a collapsed panel; null for an item that cannot play. */
function entryActivation(
  data: RecordValue,
  view: { row: HTMLElement | null; anchor: HTMLAnchorElement | null; unique: boolean },
  { queueId, panel }: EntryContext
): QueueEntry['activate'] {
  const { row, anchor } = view;
  const id = string(data.videoId);
  const navigationEndpoint = record(data.navigationEndpoint);
  const endpoint = record(navigationEndpoint.watchEndpoint);
  const playable = data.isPlayable !== false && !data.unplayableText
    && !row?.hasAttribute('disabled') && anchor?.getAttribute('aria-disabled') !== 'true';
  if (!playable) return null;
  if (anchor?.getAttribute('href')) {
    return matchesQueueUrl(anchor.href, id, queueId, endpoint.index) ? () => { if (anchor.isConnected) anchor.click(); } : null;
  }
  if (!view.unique || endpoint.videoId !== id || endpoint.playlistId !== queueId
    || (endpoint.index != null && integer(endpoint.index) == null)) return null;
  const endpointUrl = string(record(record(navigationEndpoint.commandMetadata).webCommandMetadata).url);
  if (!endpointUrl || !matchesQueueUrl(endpointUrl, id, queueId, endpoint.index)) return null;
  // Collapsed/virtualized panels can retain their model without row links.
  // Let YouTube's playlist manager carry its queue context through navigation.
  return () => {
    if (!panel.isConnected) return;
    panel.dispatchEvent(new CustomEvent('yt-navigate', {
      bubbles: true, composed: true, cancelable: true, detail: { endpoint: navigationEndpoint }
    }));
  };
}

/** YouTube text is `{simpleText}` or `{runs: [{text}]}`. */
export function runsText(value: unknown): string {
  const data = record(value);
  const text = string(data.simpleText) || (Array.isArray(data.runs) ? data.runs.map(run => string(record(run).text)).join('') : '');
  return text.replace(/\s+/g, ' ').trim();
}

/** The smallest thumbnail at least 144px wide (the 72px row at 2x), else the largest; ytimg only. */
function rowThumbnail(images: unknown): string {
  if (!Array.isArray(images) || !images.length) return '';
  const sized = images.map(record).filter(image => typeof image.url === 'string');
  const chosen = sized.find(image => (integer(image.width) ?? 0) >= 144) ?? sized[sized.length - 1];
  const url = string(chosen?.url);
  if (!url || url.length > 2000) return '';
  try {
    const parsed = new URL(url, window.location.href);
    return parsed.protocol === 'https:' && /(?:^|\.)ytimg\.com$/.test(parsed.hostname) ? parsed.href : '';
  } catch {
    return '';
  }
}

function matchesQueueUrl(href: string, videoId: string, queueId: string, index: unknown): boolean {
  try {
    const url = new URL(href, window.location.href);
    const endpointIndex = integer(index);
    const linkIndex = url.searchParams.get('index');
    // Queue links sometimes omit index. A present index that disagrees is another occurrence.
    const indexAgrees = endpointIndex == null || linkIndex == null || Number(linkIndex) === endpointIndex + 1;
    return url.origin === window.location.origin && url.pathname === '/watch'
      && url.searchParams.get('v') === videoId && url.searchParams.get('list') === queueId && indexAgrees;
  } catch {
    return false;
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

export function record(value: unknown): RecordValue {
  return value && typeof value === 'object' ? value as RecordValue : {};
}

export function string(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function integer(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
