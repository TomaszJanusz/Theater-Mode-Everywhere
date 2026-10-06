import { MAX_CAPTION_BYTES } from '../../media-features/fetch-allowlist';
import { crunchyrollCdnFile, isCrunchyrollBifFileUrl } from '../../media-features/crunchyroll-cdn';
import {
  CRUNCHYROLL_CAPTION_ACK_EVENT,
  CRUNCHYROLL_CAPTION_EVENT,
  classifyCrunchyrollManifest,
  crunchyrollCaptionAckDetail,
  crunchyrollContentTitle,
  crunchyrollDashPath,
  crunchyrollHostDeliveryTracks,
  crunchyrollMediaId,
  crunchyrollMetadataRef,
  crunchyrollOverlayTracks,
  MAX_CRUNCHYROLL_BIF_BYTES,
  parseCrunchyrollCaptionRequest,
  parseCrunchyrollCmsTitle,
  parseCrunchyrollHostList,
  parseCrunchyrollPlayback,
  parseCrunchyrollSkipEvents,
  summarizeCrunchyrollBif,
  type CrunchyrollCaption,
  type CrunchyrollCaptionRequest,
  type CrunchyrollHostRenderer,
  type CrunchyrollHostTrack,
  type CrunchyrollRendition,
  type CrunchyrollSnapshot
} from '../../media-features/parsers/crunchyroll';
import { mediaProviderIntegrationEnabled } from '../../media-features/provider-flags';
import type { Chapter } from '../../media-features/types';
import { isCrunchyrollHost } from '../hosts';

export type { CrunchyrollSnapshot } from '../../media-features/parsers/crunchyroll';

export const CRUNCHYROLL_HARVEST_EVENT = 'theater-everywhere-crunchyroll-harvest';
export const CRUNCHYROLL_SKIP_TIMEOUT_MS = 8000;
/** Pause after a failed or unusable skip document before the next probe may try again. */
export const CRUNCHYROLL_SKIP_RETRY_MS = 15000;
export const CRUNCHYROLL_BIF_TIMEOUT_MS = 15000;
/** How long MAIN waits for list() to show the requested host track. */
export const CRUNCHYROLL_HOST_CAPTION_SETTLE_MS = 800;
/**
 * Isolated ACK budget for one in-flight settle plus the request that is actually latest.
 * Intermediates already queued behind that pair reject on generation and do not add another settle.
 */
export const CRUNCHYROLL_CAPTION_ACK_TIMEOUT_MS = 2 * CRUNCHYROLL_HOST_CAPTION_SETTLE_MS + 200;
const HOST_CAPTION_POLL_MS = 40;

type Harvest = {
  mediaId: string;
  title?: string;
  softTracks: CrunchyrollCaption[];
  assetIds: string[];
  sawHardsub: boolean;
  sawClean: boolean;
  sawHost: boolean;
  burnedHint: boolean;
  chapters: Chapter[];
  bifUrl?: string;
  bifAsset?: string;
  bifBlobUrl?: string;
};

type DomTitle = { text: string; route: string; mediaId: string };
type PendingBif = { url: string; buffer: ArrayBuffer; generation: number; mediaId: string; route: string };
type CheckedGet = { get(name: string): string | null };
type CheckedResponse = {
  ok: boolean;
  url?: string;
  headers?: CheckedGet;
  body?: ReadableStream<Uint8Array> | null;
};

let state: Harvest | null = null;
let skipRequestedFor: string | null = null;
let skipAttempt = 0;
let skipRetryMedia: string | null = null;
let skipRetryAt = 0;
let sessionGeneration = 0;
let hostCaptionGeneration = 0;
let hostCaptionQueue: Promise<void> = Promise.resolve();
let bifInflight: string | null = null;
let pendingBif: PendingBif | null = null;
let publishedKey = '';
let installed = false;
let domTitle: DomTitle | null = null;
const confirmedTitles = new Map<string, string>();
const ownedUrls = new Set<string>();

export function crunchyrollIntegrationEnabled(): boolean {
  return isCrunchyrollHost() && mediaProviderIntegrationEnabled('crunchyroll');
}

export function crunchyrollPageMediaId(): string | null {
  const path = window.location?.pathname || '';
  const watch = path.match(/\/watch\/([A-Za-z0-9]{9})(?:\/|$)/i);
  const embed = path.match(/\/embed\/([A-Za-z0-9]{9})(?:\/|$)/i);
  const fromPath = crunchyrollMediaId(watch?.[1] || embed?.[1]);
  if (fromPath) return fromPath;
  const params = new URLSearchParams(window.location?.search || '');
  return crunchyrollMediaId(params.get('media_id') || params.get('mediaId'));
}

export function crunchyrollPageRoute(): string {
  return `${window.location?.pathname || ''}${window.location?.search || ''}`;
}

export function isCrunchyrollOwnedRequest(url: string): boolean {
  return ownedUrls.has(url);
}

function notify(): void {
  window.dispatchEvent(new CustomEvent(CRUNCHYROLL_HARVEST_EVENT));
}

function harvestKey(): string {
  if (!state) return '';
  return JSON.stringify({
    mediaId: state.mediaId,
    title: state.title || '',
    assets: state.assetIds,
    hard: state.sawHardsub,
    clean: state.sawClean,
    host: state.sawHost,
    burned: state.burnedHint,
    chapters: state.chapters,
    tracks: state.softTracks.map((track) => track.url),
    bif: state.bifBlobUrl || ''
  });
}

function publish(): void {
  const key = harvestKey();
  if (key === publishedKey) return;
  publishedKey = key;
  notify();
}

function revokeNow(blobUrl?: string): void {
  if (!blobUrl || typeof URL === 'undefined' || typeof URL.revokeObjectURL !== 'function') return;
  try {
    URL.revokeObjectURL(blobUrl);
  } catch {
    // Blob URLs created in this world may already be gone.
  }
}

// Blob URLs are created in this MAIN-world module. The isolated content world
// imports a separate copy, so a retain count here cannot cover its fetch.
// Replacing or leaving a route revokes the blob immediately. A late read is
// discarded by the adapter's media, route, and blob identity checks.

function clearHarvest(dropTitles: boolean): void {
  const had = Boolean(state) || publishedKey !== '';
  sessionGeneration += 1;
  skipAttempt += 1;
  skipRequestedFor = null;
  skipRetryMedia = null;
  skipRetryAt = 0;
  bifInflight = null;
  pendingBif = null;
  revokeNow(state?.bifBlobUrl);
  state = null;
  if (dropTitles) {
    domTitle = null;
    confirmedTitles.clear();
  }
  if (!had) return;
  publishedKey = '';
  notify();
}

function ensure(mediaId: string): Harvest {
  if (!state || state.mediaId !== mediaId) {
    if (state) clearHarvest(false);
    state = {
      mediaId,
      softTracks: [],
      assetIds: [],
      sawHardsub: false,
      sawClean: false,
      sawHost: false,
      burnedHint: false,
      chapters: []
    };
  }
  return state;
}

function pageMatches(mediaId: string): boolean {
  return crunchyrollIntegrationEnabled() && crunchyrollPageMediaId() === mediaId;
}

type PlayerSession = {
  rendition: Exclude<CrunchyrollRendition, 'unknown'>;
  assetId: string;
  list: () => unknown;
  enable: (id: string) => unknown;
  disable: (id: string) => unknown;
};

function readPlayerSession(mediaId: string): PlayerSession | null {
  const doc = typeof document === 'undefined' ? null : document;
  if (!doc || typeof doc.querySelectorAll !== 'function') return null;
  let nodes: unknown[] = [];
  try {
    nodes = Array.from(doc.querySelectorAll('video')).slice(0, 4);
  } catch {
    return null;
  }
  for (const start of nodes) {
    let node: unknown = start;
    for (let depth = 0; node && depth < 5; depth += 1) {
      if (typeof node !== 'object') break;
      const record = node as Record<string, unknown>;
      for (const key of ['player', '_player', '']) {
        const target = key ? record[key] : record;
        if (!target || typeof target !== 'object') continue;
        const identity = classifyCrunchyrollManifest(crunchyrollDashPath(target) || '', 'player');
        if (identity?.mediaId !== mediaId) continue;
        const subtitles = (target as { subtitles?: { list?: unknown; enable?: unknown; disable?: unknown } }).subtitles;
        const list = subtitles && typeof subtitles.list === 'function' ? subtitles.list.bind(subtitles) : null;
        const enable = subtitles && typeof subtitles.enable === 'function' ? subtitles.enable.bind(subtitles) : null;
        const disable = subtitles && typeof subtitles.disable === 'function' ? subtitles.disable.bind(subtitles) : null;
        if (!list || !enable || !disable) {
          return { rendition: identity.rendition, assetId: identity.assetId, list: () => [], enable: () => {}, disable: () => {} };
        }
        return { rendition: identity.rendition, assetId: identity.assetId, list, enable, disable };
      }
      node = record.parentElement;
    }
  }
  return null;
}

function hostView(mediaId: string, playingAsset: string | null): { tracks: CrunchyrollHostTrack[]; renderer: CrunchyrollHostRenderer } {
  const session = readPlayerSession(mediaId);
  if (!session) return { tracks: [], renderer: 'absent' };
  let listed: unknown = [];
  try {
    listed = session.list();
  } catch {
    return { tracks: [], renderer: 'unknown' };
  }
  const parsed = parseCrunchyrollHostList(listed, playingAsset || session.assetId);
  if (session.rendition === 'hardsub') return { tracks: [], renderer: parsed.renderer };
  return parsed;
}

function effectiveRendition(current: Harvest | null, mediaId: string): CrunchyrollRendition {
  const player = readPlayerSession(mediaId);
  if (player) return player.rendition;
  if (current?.sawHardsub) return 'hardsub';
  if (current?.sawHost && !current.sawClean) return 'host';
  if (current?.sawClean && !current.sawHost) return 'clean';
  if (current?.burnedHint) return 'hardsub';
  return 'unknown';
}

function boundAssets(current: Harvest, mediaId: string): Set<string> {
  const assets = new Set(current.assetIds);
  const playing = readPlayerSession(mediaId)?.assetId;
  if (playing) assets.add(playing);
  return assets;
}

function noteAsset(current: Harvest, assetId: string): void {
  if (current.assetIds.includes(assetId)) return;
  current.assetIds = [...current.assetIds, assetId];
  flushPendingBif();
}

export function noteCrunchyrollManifest(url: string): boolean {
  const identity = classifyCrunchyrollManifest(url, 'network');
  if (!identity) return false;
  if (!pageMatches(identity.mediaId)) return true;
  const current = ensure(identity.mediaId);
  noteAsset(current, identity.assetId);
  if (identity.rendition === 'hardsub') current.sawHardsub = true;
  else if (identity.rendition === 'clean') current.sawClean = true;
  else current.sawHost = true;
  publish();
  return true;
}

function titleFor(mediaId: string, cmsTitle?: string): string | undefined {
  if (cmsTitle) {
    confirmedTitles.set(mediaId, cmsTitle);
    return cmsTitle;
  }
  const route = crunchyrollPageRoute();
  const text = crunchyrollContentTitle(typeof document === 'undefined' ? null : document.title);
  const samePage = domTitle?.mediaId === mediaId && domTitle.route === route;
  if (samePage && text && domTitle && text !== domTitle.text) {
    domTitle = { text, route, mediaId };
    confirmedTitles.set(mediaId, text);
    return text;
  }
  const confirmed = confirmedTitles.get(mediaId);
  if (confirmed) return confirmed;
  if (!text) {
    // A generic title means this route has left the previous document.title behind.
    // The same episode string written after that is this media's title.
    if (domTitle && (domTitle.mediaId !== mediaId || domTitle.route !== route)) {
      domTitle = { text: '', route, mediaId };
    }
    return undefined;
  }
  if (!domTitle || domTitle.text !== text) {
    domTitle = { text, route, mediaId };
    confirmedTitles.set(mediaId, text);
    return text;
  }
  // The SPA still shows the previous episode's document.title. Copying it onto the new media id
  // is the stale-title bug; wait for a real title write or CMS.
  return undefined;
}

function advertisedBytes(headers: CheckedGet | undefined): number | null {
  const length = Number(headers?.get('content-length'));
  return Number.isFinite(length) && length >= 0 ? length : null;
}

function advertisedOverCap(headers: CheckedGet | undefined, maxBytes: number): boolean {
  const length = advertisedBytes(headers);
  return length != null && length > maxBytes;
}

function abandonBody(body: ReadableStream<Uint8Array> | null | undefined): void {
  if (!body || typeof body.cancel !== 'function') return;
  try {
    void Promise.resolve(body.cancel()).catch(() => {});
  } catch {
    // Cancel can wait on another reader. Harvest must not.
  }
}

type StreamRead = { done: boolean; value?: Uint8Array; aborted: boolean };

function readStreamChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal?: AbortSignal
): Promise<StreamRead> {
  if (signal?.aborted) return Promise.resolve({ done: true, aborted: true });
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: StreamRead) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      resolve(result);
    };
    const onAbort = () => finish({ done: true, aborted: true });
    signal?.addEventListener('abort', onAbort);
    reader.read().then(
      (result) => finish({ done: Boolean(result.done), value: result.value, aborted: false }),
      () => finish({ done: true, aborted: true })
    );
  });
}

/**
 * Reads at most maxBytes. A missing or low content-length is not a reason to
 * buffer the whole payload. Crossing the cap drops every chunk, including the
 * one that overflowed, and cancels the reader without waiting on that promise.
 * A real body without a stream is rejected; arrayBuffer() is not a fallback.
 */
async function readBoundedBytes(
  response: CheckedResponse,
  maxBytes: number,
  signal?: AbortSignal,
  timeoutMs?: number
): Promise<ArrayBuffer | null> {
  if (advertisedOverCap(response.headers, maxBytes)) {
    abandonBody(response.body);
    return null;
  }
  const body = response.body;
  if (!body || typeof body.getReader !== 'function') return null;
  const own = !signal && timeoutMs && timeoutMs > 0 ? new AbortController() : null;
  const timer = own ? setTimeout(() => own.abort(), timeoutMs) : null;
  const used = signal ?? own?.signal;
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  let early = false;
  try {
    while (!used?.aborted) {
      const next = await readStreamChunk(reader, used);
      if (next.aborted || used?.aborted) {
        early = true;
        break;
      }
      if (next.done) break;
      const value = next.value;
      if (!value?.byteLength) continue;
      if (received >= maxBytes || received + value.byteLength > maxBytes) {
        early = true;
        break;
      }
      chunks.push(value.slice());
      received += value.byteLength;
    }
  } catch {
    early = true;
  } finally {
    if (timer) clearTimeout(timer);
    try {
      if (early || used?.aborted) void Promise.resolve(reader.cancel()).catch(() => {});
      else reader.releaseLock();
    } catch {
      // Stopping this reader must not surface on the page's original response.
    }
  }
  if (early || used?.aborted || received === 0 || received > maxBytes) {
    chunks.length = 0;
    return null;
  }
  const out = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  chunks.length = 0;
  return out.buffer;
}

export async function loadCrunchyrollUrl(
  url: string,
  timeoutMs: number,
  validate: (finalUrl: string) => boolean,
  mode: 'text' | 'buffer',
  maxBytes: number
): Promise<{ finalUrl: string; text?: string; buffer?: ArrayBuffer } | null> {
  if (typeof fetch !== 'function') return null;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => controller?.abort(), timeoutMs);
  const marked = [url];
  ownedUrls.add(url);
  try {
    const response = await fetch(url, { credentials: 'omit', signal: controller?.signal }) as CheckedResponse;
    if (!response?.ok) {
      abandonBody(response?.body);
      return null;
    }
    const finalUrl = typeof response.url === 'string' && response.url ? response.url : url;
    if (!ownedUrls.has(finalUrl)) {
      ownedUrls.add(finalUrl);
      marked.push(finalUrl);
    }
    if (!validate(finalUrl)) {
      abandonBody(response.body);
      return null;
    }
    const buffer = await readBoundedBytes(response, maxBytes, controller?.signal);
    if (!buffer || buffer.byteLength > maxBytes) return null;
    if (mode === 'text') {
      const text = new TextDecoder().decode(buffer);
      if (text.length > maxBytes) return null;
      return { finalUrl, text };
    }
    return { finalUrl, buffer };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    for (const item of marked) ownedUrls.delete(item);
  }
}

function noteSkipFailure(mediaId: string, generation: number, attempt: number): void {
  if (generation !== sessionGeneration || attempt !== skipAttempt) return;
  if (skipRequestedFor === mediaId) skipRequestedFor = null;
  skipRetryMedia = mediaId;
  skipRetryAt = Date.now() + CRUNCHYROLL_SKIP_RETRY_MS;
}

/**
 * A matching document with no usable windows is complete: chapters may be empty.
 * A transport failure or a body that does not parse is not, but the next probe
 * waits out the retry interval instead of requesting on every snapshot read.
 * A completion from an older session does not clear the marker now in flight.
 */
function acceptSkipDocument(
  finalUrl: string,
  text: string,
  mediaId: string,
  generation: number,
  attempt: number,
  route: string
): boolean {
  const ref = crunchyrollMetadataRef(finalUrl);
  if (!ref || ref.kind !== 'skip' || ref.mediaId !== mediaId) return false;
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > MAX_CAPTION_BYTES) return false;
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false;
  let data: unknown;
  try {
    data = JSON.parse(trimmed);
  } catch {
    return false;
  }
  if (parseCrunchyrollSkipEvents(data, mediaId) === null) return false;
  if (generation !== sessionGeneration || attempt !== skipAttempt) return false;
  if (!pageMatches(mediaId) || crunchyrollPageRoute() !== route) return false;
  harvestCrunchyrollData(finalUrl, data);
  return true;
}

function requestSkip(mediaId: string): void {
  if (!pageMatches(mediaId) || skipRequestedFor === mediaId) return;
  if (skipRetryMedia === mediaId && Date.now() < skipRetryAt) return;
  const generation = sessionGeneration;
  const attempt = ++skipAttempt;
  const route = crunchyrollPageRoute();
  skipRequestedFor = mediaId;
  const url = `https://static.crunchyroll.com/skip-events/production/${mediaId}.json`;
  void loadCrunchyrollUrl(url, CRUNCHYROLL_SKIP_TIMEOUT_MS, (finalUrl) => {
    const ref = crunchyrollMetadataRef(finalUrl);
    return ref?.kind === 'skip' && ref.mediaId === mediaId;
  }, 'text', MAX_CAPTION_BYTES).then((loaded) => {
    if (generation !== sessionGeneration || attempt !== skipAttempt) return;
    const applied = Boolean(
      loaded?.text
      && pageMatches(mediaId)
      && crunchyrollPageRoute() === route
      && acceptSkipDocument(loaded.finalUrl, loaded.text, mediaId, generation, attempt, route)
    );
    if (generation !== sessionGeneration || attempt !== skipAttempt) return;
    if (applied) {
      if (skipRetryMedia === mediaId) {
        skipRetryMedia = null;
        skipRetryAt = 0;
      }
      return;
    }
    noteSkipFailure(mediaId, generation, attempt);
  });
}

function commitBif(buffer: ArrayBuffer, url: string, assetId: string, mediaId: string): void {
  const current = ensure(mediaId);
  if (!summarizeCrunchyrollBif(buffer)) return;
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return;
  if (current.bifUrl === url && current.bifBlobUrl) return;
  const previous = current.bifBlobUrl;
  current.bifUrl = url;
  current.bifAsset = assetId;
  current.bifBlobUrl = URL.createObjectURL(new Blob([buffer], { type: 'application/octet-stream' }));
  if (previous !== current.bifBlobUrl) revokeNow(previous);
  publish();
}

function tryCommitBif(buffer: ArrayBuffer, url: string, generation: number, mediaId: string, route: string): void {
  if (generation !== sessionGeneration || !pageMatches(mediaId) || crunchyrollPageRoute() !== route) return;
  const file = crunchyrollCdnFile(url);
  if (file?.kind !== 'bif' || !isCrunchyrollBifFileUrl(url, file.assetId)) return;
  const current = state?.mediaId === mediaId ? state : null;
  const assets = current ? boundAssets(current, mediaId) : new Set<string>();
  if (!assets.size) {
    pendingBif = { url, buffer, generation, mediaId, route };
    return;
  }
  if (!assets.has(file.assetId)) return;
  pendingBif = null;
  commitBif(buffer, url, file.assetId, mediaId);
}

function flushPendingBif(): void {
  if (!pendingBif) return;
  const pending = pendingBif;
  pendingBif = null;
  tryCommitBif(pending.buffer, pending.url, pending.generation, pending.mediaId, pending.route);
}

function requestBif(mediaId: string, url: string): void {
  const file = crunchyrollCdnFile(url);
  if (!file || !isCrunchyrollBifFileUrl(url, file.assetId) || bifInflight === url || state?.bifUrl === url) return;
  if (!pageMatches(mediaId)) return;
  bifInflight = url;
  const generation = sessionGeneration;
  const route = crunchyrollPageRoute();
  void loadCrunchyrollUrl(url, CRUNCHYROLL_BIF_TIMEOUT_MS, (finalUrl) => {
    return isCrunchyrollBifFileUrl(finalUrl, file.assetId);
  }, 'buffer', MAX_CRUNCHYROLL_BIF_BYTES).then((loaded) => {
    if (bifInflight === url) bifInflight = null;
    if (!loaded?.buffer) return;
    tryCommitBif(loaded.buffer, loaded.finalUrl, generation, mediaId, route);
  });
}

export function rememberCrunchyrollBif(buffer: ArrayBuffer, url: string): void {
  const mediaId = crunchyrollPageMediaId();
  if (!mediaId || isCrunchyrollOwnedRequest(url)) return;
  tryCommitBif(buffer, url, sessionGeneration, mediaId, crunchyrollPageRoute());
}

function rememberCaptionUrl(url: string, mediaId: string): void {
  const file = crunchyrollCdnFile(url);
  if (file?.kind !== 'ass' || file.query !== 'none') return;
  const current = ensure(mediaId);
  if (!boundAssets(current, mediaId).has(file.assetId)) return;
  if (current.softTracks.some((track) => track.url === url)) return;
  const language = file.language || 'und';
  current.softTracks = [...current.softTracks, {
    id: `crunchyroll:${mediaId}:subtitles:${language}:${current.softTracks.length}`,
    language,
    label: language,
    kind: 'subtitles',
    format: 'ass',
    url
  }];
  publish();
}

export function harvestCrunchyrollData(url: string, data: unknown): void {
  if (isCrunchyrollOwnedRequest(url)) return;
  if (noteCrunchyrollManifest(url)) return;
  const ref = crunchyrollMetadataRef(url);
  if (!ref || !pageMatches(ref.mediaId)) return;
  const current = ensure(ref.mediaId);
  if (ref.kind === 'skip') {
    const chapters = parseCrunchyrollSkipEvents(data, ref.mediaId);
    if (!chapters) return;
    current.chapters = chapters;
    publish();
    return;
  }
  if (ref.kind === 'cms') {
    const title = parseCrunchyrollCmsTitle(data, ref.mediaId);
    if (!title || title === current.title) return;
    current.title = title;
    confirmedTitles.set(ref.mediaId, title);
    publish();
    return;
  }
  const playback = parseCrunchyrollPlayback(data, ref.mediaId);
  if (!playback) return;
  current.softTracks = playback.softTracks;
  current.burnedHint = playback.burnedHint;
  for (const assetId of playback.assetIds) noteAsset(current, assetId);
  if (playback.bifUrl && playback.bifUrl !== current.bifUrl) requestBif(ref.mediaId, playback.bifUrl);
  publish();
  flushPendingBif();
}

export function harvestCrunchyrollBody(url: string, body: string): void {
  if (isCrunchyrollOwnedRequest(url)) return;
  if (noteCrunchyrollManifest(url)) return;
  const file = crunchyrollCdnFile(url);
  if (file?.kind === 'ass') {
    const mediaId = crunchyrollPageMediaId();
    if (mediaId && pageMatches(mediaId)) rememberCaptionUrl(url, mediaId);
    return;
  }
  if (!crunchyrollMetadataRef(url) || !body || body.length > MAX_CAPTION_BYTES) return;
  const text = body.trim();
  if (!text.startsWith('{') && !text.startsWith('[')) return;
  try {
    harvestCrunchyrollData(url, JSON.parse(text));
  } catch {
    // Metadata parsing must not affect playback.
  }
}

export function isCrunchyrollBifUrl(value: string): boolean {
  return isCrunchyrollBifFileUrl(value);
}

/** True only when this response's body is the one Crunchyroll harvest should read. */
export function crunchyrollCapturesResponseBody(
  url: string,
  response?: { ok?: boolean; headers?: CheckedGet }
): boolean {
  if (!isCrunchyrollHost() || !response?.ok || isCrunchyrollOwnedRequest(url) || !crunchyrollIntegrationEnabled()) return false;
  const file = crunchyrollCdnFile(url);
  if (file?.kind === 'bif' && file.query === 't') return !advertisedOverCap(response.headers, MAX_CRUNCHYROLL_BIF_BYTES);
  if (file) return false;
  if (!crunchyrollMetadataRef(url)) return false;
  return !advertisedOverCap(response.headers, MAX_CAPTION_BYTES);
}

export function captureCrunchyrollNetworkResponse(url: string, response: Response): void {
  if (!isCrunchyrollHost() || !response?.ok || isCrunchyrollOwnedRequest(url)) return;
  if (noteCrunchyrollManifest(url)) return;
  if (!crunchyrollIntegrationEnabled()) return;
  const file = crunchyrollCdnFile(url);
  if (file?.kind === 'ass') {
    const mediaId = crunchyrollPageMediaId();
    if (mediaId) rememberCaptionUrl(response.url || url, mediaId);
    return;
  }
  if (!crunchyrollCapturesResponseBody(url, response)) return;
  const finalUrl = response.url || url;
  const maxBytes = file?.kind === 'bif' ? MAX_CRUNCHYROLL_BIF_BYTES : MAX_CAPTION_BYTES;
  const timeoutMs = file?.kind === 'bif' ? CRUNCHYROLL_BIF_TIMEOUT_MS : CRUNCHYROLL_SKIP_TIMEOUT_MS;
  void readBoundedBytes(response, maxBytes, undefined, timeoutMs).then((buffer) => {
    if (!buffer) return;
    if (file?.kind === 'bif') {
      rememberCrunchyrollBif(buffer, finalUrl);
      return;
    }
    harvestCrunchyrollBody(finalUrl, new TextDecoder().decode(buffer));
  }).catch(() => {});
}

/**
 * Crunchyroll's portion of the shared fetch wrapper.
 * Owned requests and URLs this provider does not read are not cloned.
 * An accepted body is cloned once and consumed here, with no second clone.
 * 'foreign' means the caller should keep the other providers' existing clone path.
 */
export function consumeCrunchyrollWrappedFetch(
  url: string,
  response: Response,
  foreignUrl: (url: string) => boolean
): 'handled' | 'foreign' {
  if (isCrunchyrollOwnedRequest(url)) return 'handled';
  if (crunchyrollCapturesResponseBody(url, response)) {
    try {
      captureCrunchyrollNetworkResponse(url, response.clone());
    } catch {
      // A failed clone must not fall through into a second one.
    }
    return 'handled';
  }
  if (isCrunchyrollHost() && !foreignUrl(url)) {
    captureCrunchyrollNetworkResponse(url, response);
    return 'handled';
  }
  return 'foreign';
}

export function crunchyrollAllowsCaptionFetch(url?: string): boolean {
  if (!crunchyrollIntegrationEnabled()) return false;
  const mediaId = crunchyrollPageMediaId();
  if (!mediaId || !state || state.mediaId !== mediaId || !url) return false;
  const rendition = effectiveRendition(state, mediaId);
  const playing = readPlayerSession(mediaId);
  const host = hostView(mediaId, playing?.assetId || null);
  const tracks = crunchyrollOverlayTracks(rendition, host.renderer, crunchyrollHostDeliveryTracks(rendition, host.tracks), state.softTracks);
  const file = crunchyrollCdnFile(url);
  return file?.query === 'none' && tracks.some((track) => track.url === url);
}

function liveSnapshot(mediaId: string, current: Harvest | null): CrunchyrollSnapshot {
  const rendition = current ? effectiveRendition(current, mediaId) : (readPlayerSession(mediaId)?.rendition || 'unknown');
  const playing = readPlayerSession(mediaId);
  const host = hostView(mediaId, playing?.assetId || null);
  const hostTracks = crunchyrollHostDeliveryTracks(rendition, host.tracks).map(({ id, language, label, kind, enabled }) => ({
    id,
    language,
    label,
    kind,
    enabled: enabled === true
  }));
  const captionTracks = crunchyrollOverlayTracks(rendition, host.renderer, hostTracks, current?.softTracks || [])
    .filter((track) => crunchyrollCdnFile(track.url)?.query === 'none');
  const title = titleFor(mediaId, current?.title);
  return {
    mediaId,
    title,
    rendition,
    captionTracks,
    hostTracks,
    hostRenderer: host.renderer,
    chapters: current?.chapters || [],
    bifBlobUrl: current?.bifBlobUrl
  };
}

export function readCrunchyrollSnapshot(): CrunchyrollSnapshot | null {
  if (!crunchyrollIntegrationEnabled()) {
    clearHarvest(true);
    return null;
  }
  const mediaId = crunchyrollPageMediaId();
  if (!mediaId) {
    clearHarvest(false);
    return null;
  }
  if (state && state.mediaId !== mediaId) clearHarvest(false);
  const current = state?.mediaId === mediaId ? state : null;
  requestSkip(mediaId);
  return liveSnapshot(mediaId, current);
}

function listedHostTracks(session: PlayerSession): Array<{ id: string; enabled: boolean; url: string }> {
  let value: unknown = [];
  try {
    value = session.list();
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  const tracks: Array<{ id: string; enabled: boolean; url: string }> = [];
  for (const item of value.slice(0, 40)) {
    if (!item || typeof item !== 'object') continue;
    const row = item as { id?: unknown; enabled?: unknown; url?: unknown; forced?: unknown };
    // Same strict flag as parseCrunchyrollHostList. Forced narrative stays on and is not a host control target.
    if (typeof row.id !== 'string' || row.forced === true) continue;
    tracks.push({
      id: row.id,
      enabled: row.enabled === true,
      url: typeof row.url === 'string' ? row.url : ''
    });
  }
  return tracks;
}

function forcedNarrativeEnabled(session: PlayerSession): boolean {
  let value: unknown = [];
  try {
    value = session.list();
  } catch {
    return false;
  }
  if (!Array.isArray(value)) return false;
  for (const item of value.slice(0, 40)) {
    if (!item || typeof item !== 'object') continue;
    const row = item as { enabled?: unknown; forced?: unknown };
    if (row.forced === true && row.enabled === true) return true;
  }
  return false;
}

type ListedHostTrack = { id: string; enabled: boolean; url: string };

function hostCaptionCurrent(request: CrunchyrollCaptionRequest, generation: number): boolean {
  return generation === hostCaptionGeneration
    && pageMatches(request.mediaId)
    && crunchyrollPageRoute() === request.route;
}

function hostTracksSettled(tracks: ListedHostTrack[], trackId: string | null): boolean {
  if (trackId === null) return tracks.every((track) => !track.enabled);
  return tracks.some((track) => track.id === trackId && track.enabled)
    && tracks.every((track) => track.id === trackId || !track.enabled);
}

function hostTrackAccepted(session: PlayerSession, trackId: string | null): boolean {
  const tracks = listedHostTracks(session);
  if (!hostTracksSettled(tracks, trackId)) return false;
  if (trackId === null) return true;
  const selected = tracks.find((track) => track.id === trackId);
  const file = selected ? crunchyrollCdnFile(selected.url) : null;
  // The query is not an identity check. Enabling uses the player track id only.
  return Boolean(selected && file?.kind === 'vtt' && file.assetId === session.assetId);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function settlePlayerCall(result: unknown, deadline: number): Promise<void> {
  const pending = result && typeof (result as Promise<unknown>).then === 'function'
    ? Promise.resolve(result).then(() => undefined, () => undefined)
    : Promise.resolve();
  const remaining = Math.max(0, deadline - Date.now());
  await Promise.race([pending, delay(remaining)]);
}

type HostCaptionApplyResult = { ok: boolean; kept: boolean };

function ownedSelection(session: PlayerSession, ownedTrackId: string): 'owned' | 'other' | 'off' {
  const enabled = listedHostTracks(session).filter((track) => track.enabled);
  if (enabled.length === 0) return 'off';
  if (enabled.length !== 1 || enabled[0].id !== ownedTrackId) return 'other';
  const file = crunchyrollCdnFile(enabled[0].url);
  if (file?.kind !== 'vtt' || file.assetId !== session.assetId) return 'other';
  return 'owned';
}

/**
 * Automatic Off names the track RTE enabled. Disable that track only while it
 * is still the sole live selection. A track chosen in the player is left on.
 */
async function applyOwnedCaptionOff(
  request: CrunchyrollCaptionRequest,
  ownedTrackId: string,
  generation: number
): Promise<HostCaptionApplyResult> {
  const deadline = Date.now() + CRUNCHYROLL_HOST_CAPTION_SETTLE_MS;
  const settled = (kept: boolean): HostCaptionApplyResult => (
    hostCaptionCurrent(request, generation) ? { ok: true, kept } : { ok: false, kept: false }
  );
  if (!hostCaptionCurrent(request, generation)) return { ok: false, kept: false };
  const session = readPlayerSession(request.mediaId);
  if (!session || session.rendition === 'hardsub') return { ok: hostCaptionCurrent(request, generation), kept: false };
  const initial = ownedSelection(session, ownedTrackId);
  if (initial === 'off') return settled(false);
  if (initial !== 'owned') return settled(true);
  try {
    await settlePlayerCall(session.disable(ownedTrackId), deadline);
  } catch {
    return { ok: false, kept: false };
  }
  for (;;) {
    if (!pageMatches(request.mediaId) || crunchyrollPageRoute() !== request.route) return { ok: false, kept: false };
    const live = readPlayerSession(request.mediaId);
    if (!live || live.rendition === 'hardsub') return { ok: hostCaptionCurrent(request, generation), kept: false };
    const now = ownedSelection(live, ownedTrackId);
    if (now === 'off') return settled(false);
    if (now !== 'owned') return settled(true);
    const remaining = deadline - Date.now();
    if (remaining <= 0) return { ok: false, kept: false };
    await delay(Math.min(HOST_CAPTION_POLL_MS, remaining));
  }
}

/**
 * Bitmovin enable/disable can resolve before list() reports the new state.
 * Poll list() inside the settle budget. A newer caption request, route, or
 * integration change makes this attempt fail instead of acknowledging success.
 */
async function applyUnscopedHostCaption(
  request: CrunchyrollCaptionRequest,
  generation = hostCaptionGeneration
): Promise<boolean> {
  const deadline = Date.now() + CRUNCHYROLL_HOST_CAPTION_SETTLE_MS;
  if (!hostCaptionCurrent(request, generation)) return false;
  const session = readPlayerSession(request.mediaId);
  if (!session || session.rendition === 'hardsub') return request.trackId === null && hostCaptionCurrent(request, generation);
  if (request.trackId !== null) {
    const selected = listedHostTracks(session).find((track) => track.id === request.trackId);
    const file = selected ? crunchyrollCdnFile(selected.url) : null;
    if (!selected || file?.kind !== 'vtt' || file.assetId !== session.assetId) return false;
  }
  if (hostTrackAccepted(session, request.trackId)) return hostCaptionCurrent(request, generation);
  try {
    const initial = listedHostTracks(session);
    if (request.trackId === null) {
      for (const track of initial) {
        if (!hostCaptionCurrent(request, generation)) return false;
        if (!track.enabled) continue;
        await settlePlayerCall(session.disable(track.id), deadline);
      }
    } else {
      for (const track of initial) {
        if (!hostCaptionCurrent(request, generation)) return false;
        if (track.id === request.trackId || !track.enabled) continue;
        await settlePlayerCall(session.disable(track.id), deadline);
      }
      if (!hostCaptionCurrent(request, generation)) return false;
      const live = readPlayerSession(request.mediaId);
      if (!live || live.rendition === 'hardsub') return false;
      if (!hostTrackAccepted(live, request.trackId)) {
        await settlePlayerCall(live.enable(request.trackId), deadline);
      }
    }
  } catch {
    return false;
  }
  // After a player call is issued, wait until list() shows that state even if a
  // newer request has started. Returning early would let the older enable land
  // after the newer off/on. The queued request then corrects the player.
  // A route or integration change does not wait out the budget.
  for (;;) {
    if (!pageMatches(request.mediaId) || crunchyrollPageRoute() !== request.route) return false;
    const live = readPlayerSession(request.mediaId);
    if (!live || live.rendition === 'hardsub') {
      return request.trackId === null && hostCaptionCurrent(request, generation);
    }
    if (hostTrackAccepted(live, request.trackId)) return hostCaptionCurrent(request, generation);
    const remaining = deadline - Date.now();
    if (remaining <= 0) return false;
    await delay(Math.min(HOST_CAPTION_POLL_MS, remaining));
  }
}

export async function applyCrunchyrollHostCaption(
  request: CrunchyrollCaptionRequest,
  generation = hostCaptionGeneration
): Promise<HostCaptionApplyResult> {
  if (request.trackId === null && request.ownedTrackId) {
    return applyOwnedCaptionOff(request, request.ownedTrackId, generation);
  }
  const ok = await applyUnscopedHostCaption(request, generation);
  if (!ok || request.trackId !== null || !hostCaptionCurrent(request, generation)) return { ok, kept: false };
  const session = readPlayerSession(request.mediaId);
  // Selectable tracks are off. A forced row can still be showing in the same renderer.
  const kept = Boolean(session && session.rendition !== 'hardsub' && forcedNarrativeEnabled(session));
  return { ok: true, kept };
}

function acknowledgeHostCaption(request: CrunchyrollCaptionRequest, result: HostCaptionApplyResult): void {
  const mediaId = crunchyrollPageMediaId() || request.mediaId;
  const route = crunchyrollPageRoute();
  const ok = result.ok && mediaId === request.mediaId && route === request.route;
  window.dispatchEvent(new CustomEvent(CRUNCHYROLL_CAPTION_ACK_EVENT, {
    detail: crunchyrollCaptionAckDetail({
      requestId: request.requestId,
      ok,
      mediaId,
      route,
      trackId: request.trackId,
      ...(ok && result.kept ? { kept: true } : {})
    })
  }));
}

export function handleCrunchyrollCaptionEvent(event: Event): void {
  const request = parseCrunchyrollCaptionRequest((event as CustomEvent<unknown>).detail);
  if (!request) return;
  const generation = ++hostCaptionGeneration;
  const queued = hostCaptionQueue.then(async () => {
    // A request that was only waiting in line is already stale. Reject it before list()/enable/disable
    // so it cannot spend another settle budget or change the player after a newer request.
    if (generation !== hostCaptionGeneration) {
      acknowledgeHostCaption(request, { ok: false, kept: false });
      return;
    }
    let result: HostCaptionApplyResult = { ok: false, kept: false };
    try {
      result = await applyCrunchyrollHostCaption(request, generation);
    } catch {
      result = { ok: false, kept: false };
    }
    if (generation !== hostCaptionGeneration) result = { ok: false, kept: false };
    acknowledgeHostCaption(request, result);
  });
  hostCaptionQueue = queued.then(() => undefined, () => undefined);
}

function syncPage(fetchSkip: boolean): void {
  if (!crunchyrollIntegrationEnabled()) {
    clearHarvest(true);
    return;
  }
  const mediaId = crunchyrollPageMediaId();
  if (!mediaId) {
    clearHarvest(false);
    return;
  }
  if (state && state.mediaId !== mediaId) clearHarvest(false);
  if (fetchSkip) requestSkip(mediaId);
}

export function installCrunchyrollMain(): void {
  if (!isCrunchyrollHost() || installed) return;
  installed = true;
  syncPage(true);
  window.addEventListener(CRUNCHYROLL_CAPTION_EVENT, handleCrunchyrollCaptionEvent as EventListener);
  window.addEventListener('popstate', () => syncPage(true));
  const historyRef = window.history;
  if (!historyRef || (historyRef as History & { _teCrunchyroll?: boolean })._teCrunchyroll) return;
  const wrap = (original: History['pushState']) => function (this: History, ...args: Parameters<History['pushState']>) {
    const result = original.apply(this, args);
    syncPage(true);
    return result;
  };
  try {
    historyRef.pushState = wrap(historyRef.pushState);
    historyRef.replaceState = wrap(historyRef.replaceState);
    (historyRef as History & { _teCrunchyroll?: boolean })._teCrunchyroll = true;
  } catch {
    // History can be sealed. Skip metadata still arrives if the player requests it.
  }
}
