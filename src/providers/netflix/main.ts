import { MAX_NETFLIX_PREVIEW_BYTES, NETFLIX_PREVIEW_EVENT, NETFLIX_PREVIEW_ID, parseNetflixPreviewRequest } from '../../media-features/parsers/netflix-preview';
import { sanitizeContentTitle } from '../../media-features/content-title';
import {
  NETFLIX_CAPTION_ACK_EVENT,
  NETFLIX_CAPTION_EVENT,
  NETFLIX_HARVEST_EVENT,
  NETFLIX_SNAPSHOT_ID,
  applyNetflixPlayerCaption,
  netflixCaptionAckDetail,
  netflixCaptionList,
  netflixHarvestKey,
  netflixHostCaptionsAvailable,
  netflixLiveTrackId,
  type NetflixCaptionApi,
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
import { relayNetflixShadowClick } from './shadow-click';
import { netflixSessionTitle, netflixWatchId, playNetflixNextEpisode, readNetflixPlayerAppApi, selectNetflixSession, seekNetflixSession } from './session';
import { NETFLIX_ACTION_ACK_EVENT, NETFLIX_ACTION_EVENT, NETFLIX_ACTION_SNAPSHOT_ID, validNetflixTimedActionId } from './action-bridge';
import { NETFLIX_NEXT_ACK_EVENT, NETFLIX_NEXT_EVENT } from './next-episode';
import { NETFLIX_NEXT_PREVIEW_ID, syncNetflixNextPreview } from './next-preview';
import { activateNetflixTimedAction, syncNetflixTimedAction } from './timed-action';

export function netflixIntegrationEnabled(): boolean {
  return Boolean(document.documentElement && mediaProviderIntegrationEnabled('netflix'));
}

type NetflixHarvest = {
  videoId?: string;
  title?: string;
  captions?: boolean;
  previews?: boolean;
  tracks: NetflixTextTrack[];
  selectedTrackId?: string;
};

let harvest: NetflixHarvest = { tracks: [] };
let previousVideoId: string | null = null;
let notifyTimer = 0;

function playerRoot(): HTMLElement | null {
  const player = document.querySelector('.watch-video [data-uia="player"]')
    || document.querySelector('.nf-player-container, [data-uia="player"]');
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

type PlayerProps = NetflixCaptionApi & {
  videoId?: unknown;
  selectedTextTrack?: { trackId?: unknown; displayName?: unknown };
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

type PlayerFiber = {
  memoizedProps?: PlayerProps;
  stateNode?: PlayerProps & {
    player?: PlayerProps;
    _player?: PlayerProps;
    state?: { fallbackMode?: unknown; uiState?: unknown };
  };
  child?: PlayerFiber;
  sibling?: PlayerFiber;
  return?: PlayerFiber;
};

const CAPTION_SUPPORT_PARENT_LIMIT = 8;

function reactFiber(root: HTMLElement): PlayerFiber | null {
  const key = Object.keys(root).find((name) => name.startsWith('__reactFiber') || name.startsWith('__reactInternalInstance'));
  const fiber = key ? (root as unknown as Record<string, PlayerFiber>)[key] : null;
  return fiber && typeof fiber === 'object' ? fiber : null;
}

function playerFibers(root: HTMLElement): PlayerFiber[] {
  const fiber = reactFiber(root);
  if (!fiber) return [];
  const seen = new Set<object>();
  const stack: PlayerFiber[] = [fiber];
  const fibers: PlayerFiber[] = [];
  while (stack.length && seen.size < 800) {
    const node = stack.pop();
    if (!node || typeof node !== 'object' || seen.has(node)) continue;
    seen.add(node);
    fibers.push(node);
    if (node.child) stack.push(node.child);
    if (node.sibling) stack.push(node.sibling);
  }
  return fibers;
}

function findPlayerProps(root: HTMLElement): PlayerProps | null {
  for (const node of playerFibers(root)) {
    const props = node.memoizedProps;
    if (props && Array.isArray(props.textTracks) && typeof props.setTimedTextTrack === 'function') return props;
  }
  return null;
}

function captionApis(root: HTMLElement): NetflixCaptionApi[] {
  const found: NetflixCaptionApi[] = [];
  const push = (api: NetflixCaptionApi | null | undefined) => {
    if (!api || typeof api.setTimedTextTrack !== 'function') return;
    const list = netflixCaptionList(api);
    if (!Array.isArray(list) || list.length === 0 || found.includes(api)) return;
    found.push(api);
  };
  for (const node of playerFibers(root)) {
    push(node.memoizedProps);
    push(node.stateNode);
    push(node.stateNode?.player);
    push(node.stateNode?._player);
  }
  found.sort((left, right) => Number(typeof right.getTimedTextTrack === 'function') - Number(typeof left.getTimedTextTrack === 'function'));
  return found;
}

function readCaptionSupportState(fiber: PlayerFiber, support: { fallbackTrue: boolean; fallbackFalse: boolean; loading: boolean; settled: boolean }): void {
  const state = fiber.stateNode?.state;
  if (!state || typeof state !== 'object') return;
  if (state.fallbackMode === true) support.fallbackTrue = true;
  else if (state.fallbackMode === false) support.fallbackFalse = true;
  if (state.uiState === 'loading') support.loading = true;
  else if (typeof state.uiState === 'string') support.settled = true;
}

function netflixCaptionSupport(root: HTMLElement | null): {
  rendererMounted: boolean;
  fallbackMode: boolean | null;
  playerLoading: boolean | null;
} {
  const rendererMounted = root?.querySelector('.player-timedtext') instanceof HTMLElement;
  const support = { fallbackTrue: false, fallbackFalse: false, loading: false, settled: false };
  if (root) {
    for (const fiber of playerFibers(root)) readCaptionSupportState(fiber, support);
    let parent = reactFiber(root)?.return;
    const seen = new Set<object>();
    for (let i = 0; parent && i < CAPTION_SUPPORT_PARENT_LIMIT; i += 1) {
      if (typeof parent !== 'object' || seen.has(parent)) break;
      seen.add(parent);
      readCaptionSupportState(parent, support);
      parent = parent.return;
    }
    const layout = root.querySelector('.PlayerControlsNeo__layout');
    if (layout?.classList.contains('PlayerControlsNeo__layout--loading')) support.loading = true;
    else if (layout) support.settled = true;
  }
  return {
    rendererMounted,
    fallbackMode: support.fallbackTrue ? true : support.fallbackFalse ? false : null,
    playerLoading: support.loading ? true : support.settled ? false : null
  };
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
  const blocked = state.captions === false;
  if (!state.videoId && !state.title && state.tracks.length === 0 && !blocked) return null;
  const tracks = blocked ? [] : state.tracks;
  return {
    ...(state.videoId ? { videoId: state.videoId } : {}),
    ...(state.title ? { title: state.title } : {}),
    ...(state.previews === true ? { previews: true } : {}),
    ...(state.captions === true ? { captions: true } : {}),
    ...(blocked ? { captions: false } : {}),
    tracks: tracks.map((track) => ({
      id: track.id,
      language: track.language,
      label: track.label,
      kind: track.kind,
      forced: track.forced,
      none: track.none
    })),
    ...(!blocked && state.selectedTrackId ? { selectedTrackId: state.selectedTrackId } : {})
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
  const preview = node instanceof Element ? node : node.parentElement;
  if (preview && [NETFLIX_PREVIEW_ID, NETFLIX_ACTION_SNAPSHOT_ID, NETFLIX_NEXT_PREVIEW_ID].some(id => preview.id === id || preview.closest(`#${id}`))) return true;
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
  if (!document.documentElement) return;
  if (!netflixIntegrationEnabled() || !isNetflixHost()) {
    publishHiddenJson(NETFLIX_ACTION_SNAPSHOT_ID, null);
    syncNetflixNextPreview(null, null);
    if (harvest.tracks.length || harvest.title || harvest.videoId) {
      harvest = { tracks: [] };
      previousVideoId = null;
      publishHarvest();
      notifyHarvest();
    }
    return;
  }
  const root = playerRoot();
  syncNetflixTimedAction(root);
  const watchId = netflixWatchId(window.location.pathname);
  const appApi = readNetflixPlayerAppApi();
  let currentVideo: unknown = null;
  try {
    if (watchId) currentVideo = appApi?.getVideoMetadataByVideoId?.(Number(watchId))?.getCurrentVideo?.();
  } catch {
    // A closed player throws here. Captions still come from the session below.
  }
  syncNetflixNextPreview(watchId, currentVideo);
  const session = selectNetflixSession(appApi, root, watchId);
  // A /watch route with no matching session is loading, not a public trailer.
  const props = !watchId && root ? findPlayerProps(root) : null;
  const videoId = watchId || netflixVideoId(session?.getMovieId?.()) || netflixVideoId(props?.videoId) || numericAncestorId(root);
  if (!netflixSnapshotMatchesVideo(harvest.videoId, videoId)) {
    harvest = { tracks: [] };
    previousVideoId = null;
  }
  const captions = session ? session.isReady?.() === true : !watchId && netflixHostCaptionsAvailable(netflixCaptionSupport(root));
  const api = session || (root && !watchId ? captionApis(root)[0] : null) || props;
  const tracks = captions && api ? parseNetflixTextTracks(netflixCaptionList(api)) : [];
  const selectedTrackId = captions && api ? netflixLiveTrackId(api) || undefined : undefined;
  const title = resolveNetflixTitle({
    videoId,
    previousVideoId,
    previousTitle: harvest.title || null,
    playerTitle: netflixSessionTitle(appApi, session ? videoId : null) || (props ? playerTitleFromProps(props) : null),
    controlTitle: watchId ? null : controlTitle(),
    documentTitle: document.title
  });
  const nextHarvest: NetflixHarvest = {
    ...(videoId ? { videoId } : {}),
    ...(title ? { title: sanitizeContentTitle(title) || undefined } : {}),
    captions,
    previews: Boolean(session?.isReady?.() && typeof session.getTrickPlayFrame === 'function'),
    tracks,
    ...(selectedTrackId ? { selectedTrackId } : {})
  };
  if (netflixHarvestKey(harvest) === netflixHarvestKey(nextHarvest)) return;
  harvest = nextHarvest;
  previousVideoId = videoId;
  publishHarvest();
  notifyHarvest();
}

function applyCaptionRequest(trackId: string | null, requestedVideoId?: string): boolean {
  if (!netflixIntegrationEnabled()) return false;
  const root = playerRoot();
  if (!root) return false;
  const watchId = netflixWatchId(window.location.pathname);
  const session = selectNetflixSession(readNetflixPlayerAppApi(), root, watchId);
  const currentId = watchId || netflixVideoId(session?.getMovieId?.()) || netflixVideoId(findPlayerProps(root)?.videoId) || numericAncestorId(root);
  if (requestedVideoId && currentId !== requestedVideoId) return false;
  const captionsAvailable = session ? session.isReady?.() === true : !watchId && netflixHostCaptionsAvailable(netflixCaptionSupport(root));
  const apis = session ? [session] : watchId ? [] : captionApis(root);
  for (const api of apis) {
    if (!applyNetflixPlayerCaption(api, trackId, captionsAvailable)) continue;
    syncHarvest();
    return true;
  }
  return false;
}

export function readNetflixSnapshot(): Record<string, unknown> | null {
  if (!isNetflixHost() || !netflixIntegrationEnabled()) return null;
  syncHarvest();
  return publishedNetflixPayload(harvest);
}

export function installNetflixMain(): void {
  if (!isNetflixHost()) return;
  window.addEventListener('click', relayNetflixShadowClick, true);
  window.addEventListener(NETFLIX_NEXT_EVENT, (event: Event) => {
    const videoId = (event as CustomEvent<unknown>).detail;
    const id = typeof videoId === 'string' ? videoId : '';
    const api = readNetflixPlayerAppApi();
    const ok = netflixIntegrationEnabled()
      && netflixVideoId(id) === id
      && playNetflixNextEpisode(api, selectNetflixSession(api, playerRoot(), id), id);
    window.dispatchEvent(new CustomEvent(NETFLIX_NEXT_ACK_EVENT, { detail: `${ok ? 'ok' : 'no'}:${id}` }));
  });
  window.addEventListener(NETFLIX_ACTION_EVENT, (event: Event) => {
    const id = (event as CustomEvent<unknown>).detail;
    if (!netflixIntegrationEnabled() || !validNetflixTimedActionId(id)) return;
    const ok = activateNetflixTimedAction(playerRoot(), id);
    syncHarvest();
    window.dispatchEvent(new CustomEvent(NETFLIX_ACTION_ACK_EVENT, { detail: `${ok ? 'ok' : 'no'}:${id}` }));
  });
  window.addEventListener(NETFLIX_PREVIEW_EVENT, (event: Event) => {
    const request = parseNetflixPreviewRequest((event as CustomEvent<unknown>).detail);
    if (request) publishNetflixPreview(request.videoId, request.time);
  });
  window.addEventListener(NETFLIX_CAPTION_EVENT, (event: Event) => {
    const request = parseNetflixCaptionRequest((event as CustomEvent<unknown>).detail);
    if (!request) return;
    const ok = applyCaptionRequest(request.trackId, request.videoId);
    window.dispatchEvent(new CustomEvent(NETFLIX_CAPTION_ACK_EVENT, {
      detail: netflixCaptionAckDetail({ requestId: request.requestId, ok })
    }));
  });
  const observer = new MutationObserver((records) => {
    if (netflixMutationIsOwnSnapshot(records)) return;
    syncHarvest();
  });
  observer.observe(document, { childList: true, subtree: true });
  window.setInterval(syncHarvest, 1500);
  syncHarvest();
}

/** Host-controlled DRM playback uses the Netflix clock in milliseconds. */
export function handleNetflixMediaSeek(detail: { time?: number; resumeAfterSeek?: boolean }, video: HTMLVideoElement | null): boolean {
  if (!isNetflixHost() || !netflixIntegrationEnabled()) return false;
  const root = playerRoot();
  if (!video || !root?.contains(video)) return false;
  const player = selectNetflixSession(readNetflixPlayerAppApi(), root, netflixWatchId(window.location.pathname));
  if (!player || typeof detail.time !== 'number') return false;
  return seekNetflixSession(player, detail.time, detail.resumeAfterSeek === true);
}

function publishNetflixPreview(videoId: string, time: number): void {
  publishHiddenJson(NETFLIX_PREVIEW_ID, null);
  if (!netflixIntegrationEnabled()) return;
  const player = selectNetflixSession(readNetflixPlayerAppApi(), playerRoot(), netflixWatchId(window.location.pathname));
  if (!player || netflixVideoId(player.getMovieId?.()) !== videoId || !player.isReady?.()) return;
  try {
    const frame = player.getTrickPlayFrame?.(Math.round(time * 1000)) as { image?: unknown; time?: number; width?: number; height?: number } | null;
    if (!frame || !(frame.image instanceof Uint8Array) || frame.image.length < 4 || frame.image.length > MAX_NETFLIX_PREVIEW_BYTES) return;
    if (frame.image[0] !== 255 || frame.image[1] !== 216) return;
    if (![frame.width, frame.height].every(value => Number.isInteger(value) && value! > 0 && value! <= 1024)) return;
    if (!Number.isFinite(frame.time) || frame.time! < 0 || Math.abs(frame.time! / 1000 - time) > 30) return;
    let binary = '';
    for (let i = 0; i < frame.image.length; i += 8192) binary += String.fromCharCode(...frame.image.subarray(i, i + 8192));
    publishHiddenJson(NETFLIX_PREVIEW_ID, { videoId, requestTime: time, time: frame.time! / 1000, width: frame.width, height: frame.height, url: `data:image/jpeg;base64,${btoa(binary)}` });
  } catch { /* No cached host thumbnail for this position yet. */ }
}
