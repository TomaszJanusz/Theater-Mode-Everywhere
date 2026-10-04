import { sanitizeContentTitle } from '../../media-features/content-title';
import {
  NETFLIX_CAPTION_ACK_EVENT,
  NETFLIX_CAPTION_EVENT,
  NETFLIX_HARVEST_EVENT,
  NETFLIX_SNAPSHOT_ID,
  chooseNetflixRawTrack,
  netflixCaptionAckDetail,
  netflixHarvestKey,
  netflixSnapshotMatchesVideo,
  netflixVideoId,
  parseNetflixCaptionRequest,
  parseNetflixTextTracks,
  resolveNetflixTitle,
  stripNetflixSiteTitle,
  type NetflixTextTrack
} from '../../media-features/parsers/netflix-page';
import { mediaProviderIntegrationEnabled } from '../../media-features/provider-flags';
import { publishHiddenJson } from '../../platform/hidden-json';
import { isNetflixHost } from '../hosts';

export function netflixIntegrationEnabled(): boolean {
  return mediaProviderIntegrationEnabled('netflix');
}

type NetflixHarvest = {
  videoId?: string;
  title?: string;
  tracks: NetflixTextTrack[];
  selectedTrackId?: string;
};

let harvest: NetflixHarvest = { tracks: [] };
let previousVideoId: string | null = null;
let notifyTimer = 0;

function playerRoot(): HTMLElement | null {
  const player = document.querySelector('.nf-player-container, [data-uia="player"]');
  return player instanceof HTMLElement ? player : null;
}

function numericAncestorId(start: Element | null): string | null {
  let node: Element | null = start;
  while (node && node !== document.body) {
    const id = netflixVideoId(node.id);
    if (id) return id;
    node = node.parentElement;
  }
  return null;
}

type PlayerProps = {
  videoId?: unknown;
  textTracks?: unknown;
  selectedTextTrack?: { trackId?: unknown; displayName?: unknown };
  setTimedTextTrack?: (track: unknown) => unknown;
  activeVideo?: unknown;
};

function readOwnStrings(value: unknown, depth: number, found: string[]): void {
  if (!value || typeof value !== 'object' || depth > 3 || found.length > 4) return;
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (/url|uri|src|token|license|stream|manifest|path/i.test(key)) continue;
    const nested = record[key];
    if (typeof nested === 'string' && /title|name/i.test(key)) {
      const title = stripNetflixSiteTitle(nested);
      if (title) found.push(title);
    } else if (nested && typeof nested === 'object') {
      readOwnStrings(nested, depth + 1, found);
    }
  }
  if (found.length > 0) return;
  const titled = record as { getTitle?: () => unknown; title?: unknown };
  if (typeof titled.getTitle === 'function') {
    try {
      const title = stripNetflixSiteTitle(titled.getTitle());
      if (title) found.push(title);
    } catch {
      // Title getters on the host player are optional.
    }
  }
}

function playerTitleFromProps(props: PlayerProps): string | null {
  const found: string[] = [];
  readOwnStrings(props.activeVideo, 0, found);
  return found[0] || null;
}

function findPlayerProps(root: HTMLElement): PlayerProps | null {
  const key = Object.keys(root).find((name) => name.startsWith('__reactFiber') || name.startsWith('__reactInternalInstance'));
  const fiber = key ? (root as unknown as Record<string, { memoizedProps?: PlayerProps; child?: unknown; sibling?: unknown }>)[key] : null;
  if (!fiber) return null;
  const seen = new Set<object>();
  const stack: Array<{ memoizedProps?: PlayerProps; child?: unknown; sibling?: unknown }> = [fiber];
  while (stack.length && seen.size < 400) {
    const node = stack.pop();
    if (!node || typeof node !== 'object' || seen.has(node)) continue;
    seen.add(node);
    const props = node.memoizedProps;
    if (props && Array.isArray(props.textTracks) && typeof props.setTimedTextTrack === 'function') return props;
    if (node.child && typeof node.child === 'object') stack.push(node.child as typeof fiber);
    if (node.sibling && typeof node.sibling === 'object') stack.push(node.sibling as typeof fiber);
  }
  return null;
}

function controlTitle(): string | null {
  const buttons = document.querySelectorAll('button[aria-pressed="true"], button[aria-current="true"]');
  for (const button of buttons) {
    const title = stripNetflixSiteTitle(button.getAttribute('aria-label') || button.textContent);
    if (title) return title;
  }
  return null;
}

export function publishedNetflixPayload(state: NetflixHarvest): Record<string, unknown> | null {
  if (!state.videoId && !state.title && state.tracks.length === 0) return null;
  return {
    ...(state.videoId ? { videoId: state.videoId } : {}),
    ...(state.title ? { title: state.title } : {}),
    tracks: state.tracks.map((track) => ({
      id: track.id,
      language: track.language,
      label: track.label,
      kind: track.kind,
      forced: track.forced,
      none: track.none
    })),
    ...(state.selectedTrackId ? { selectedTrackId: state.selectedTrackId } : {})
  };
}

function publishHarvest(): void {
  const payload = publishedNetflixPayload(harvest);
  const serialized = payload == null ? null : JSON.stringify(payload);
  const existing = document.getElementById(NETFLIX_SNAPSHOT_ID);
  const current = existing ? existing.textContent : null;
  if (serialized === current) return;
  if (serialized == null && !existing) return;
  publishHiddenJson(NETFLIX_SNAPSHOT_ID, payload);
}

export function netflixMutationIsOwnSnapshot(records: Array<{
  target: Node;
  addedNodes?: ArrayLike<Node>;
  removedNodes?: ArrayLike<Node>;
}>): boolean {
  if (records.length === 0) return false;
  return records.every((record) => {
    if (nodeInsideSnapshot(record.target)) return true;
    const nodes = [
      ...Array.from(record.addedNodes || []),
      ...Array.from(record.removedNodes || [])
    ];
    return nodes.length > 0 && nodes.every((node) => nodeInsideSnapshot(node));
  });
}

function nodeInsideSnapshot(node: Node): boolean {
  if (node instanceof Element && node.id === NETFLIX_SNAPSHOT_ID) return true;
  const element = node instanceof Element ? node : node.parentElement;
  return Boolean(element && (element.id === NETFLIX_SNAPSHOT_ID || element.closest(`#${NETFLIX_SNAPSHOT_ID}`)));
}

function notifyHarvest(): void {
  if (notifyTimer) window.clearTimeout(notifyTimer);
  notifyTimer = window.setTimeout(() => {
    notifyTimer = 0;
    window.dispatchEvent(new CustomEvent(NETFLIX_HARVEST_EVENT));
  }, 120);
}

function syncHarvest(): void {
  if (!netflixIntegrationEnabled() || !isNetflixHost()) {
    if (harvest.tracks.length || harvest.title || harvest.videoId) {
      harvest = { tracks: [] };
      previousVideoId = null;
      publishHarvest();
      notifyHarvest();
    }
    return;
  }
  const root = playerRoot();
  const props = root ? findPlayerProps(root) : null;
  const videoId = netflixVideoId(props?.videoId) || numericAncestorId(root);
  if (!netflixSnapshotMatchesVideo(harvest.videoId, videoId)) {
    harvest = { tracks: [] };
    previousVideoId = videoId;
  }
  const tracks = parseNetflixTextTracks(props?.textTracks);
  const selectedTrackId = typeof props?.selectedTextTrack?.trackId === 'string'
    ? props.selectedTextTrack.trackId
    : undefined;
  const title = resolveNetflixTitle({
    videoId,
    previousVideoId,
    previousTitle: harvest.title || null,
    playerTitle: props ? playerTitleFromProps(props) : null,
    controlTitle: controlTitle(),
    documentTitle: document.title
  });
  const nextHarvest: NetflixHarvest = {
    ...(videoId ? { videoId } : {}),
    ...(title ? { title: sanitizeContentTitle(title) || undefined } : {}),
    tracks,
    ...(selectedTrackId ? { selectedTrackId } : {})
  };
  if (netflixHarvestKey(harvest) === netflixHarvestKey(nextHarvest)) return;
  harvest = nextHarvest;
  previousVideoId = videoId;
  publishHarvest();
  notifyHarvest();
}

function applyCaptionRequest(trackId: string | null): boolean {
  if (!netflixIntegrationEnabled()) return false;
  const root = playerRoot();
  const props = root ? findPlayerProps(root) : null;
  if (!props || typeof props.setTimedTextTrack !== 'function') return false;
  const raw = chooseNetflixRawTrack(props.textTracks, trackId);
  if (!raw) return false;
  try {
    props.setTimedTextTrack(raw);
  } catch {
    return false;
  }
  syncHarvest();
  return true;
}

export function readNetflixSnapshot(): Record<string, unknown> | null {
  if (!isNetflixHost() || !netflixIntegrationEnabled()) return null;
  syncHarvest();
  if (!harvest.videoId && !harvest.title && harvest.tracks.length === 0) return null;
  return {
    ...(harvest.videoId ? { videoId: harvest.videoId } : {}),
    ...(harvest.title ? { title: harvest.title } : {}),
    tracks: harvest.tracks,
    ...(harvest.selectedTrackId ? { selectedTrackId: harvest.selectedTrackId } : {})
  };
}

export function installNetflixMain(): void {
  if (!isNetflixHost()) return;
  window.addEventListener(NETFLIX_CAPTION_EVENT, (event: Event) => {
    const request = parseNetflixCaptionRequest((event as CustomEvent<unknown>).detail);
    if (!request) return;
    const ok = applyCaptionRequest(request.trackId);
    window.dispatchEvent(new CustomEvent(NETFLIX_CAPTION_ACK_EVENT, {
      detail: netflixCaptionAckDetail({ requestId: request.requestId, ok })
    }));
  });
  const observer = new MutationObserver((records) => {
    if (netflixMutationIsOwnSnapshot(records)) return;
    syncHarvest();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.setInterval(syncHarvest, 1500);
  syncHarvest();
}
