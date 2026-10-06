import { sanitizeContentTitle } from '../content-title';
import { crunchyrollCdnFile, isCrunchyrollBifFileUrl } from '../crunchyroll-cdn';
import { parseBilibiliIntlCaptions } from './bilibili-intl';
import { parseCaptionPayload } from './captions';
import { parseRokuBif } from './disney-page';
import type { CaptionCue, Chapter } from '../types';

/**
 * Playback metadata: https://www.crunchyroll.com/playback/v3/{mediaId}/web/chrome/play
 * Skip windows: https://static.crunchyroll.com/skip-events/production/{mediaId}.json
 * beta-api.crunchyroll.com is not a metadata origin.
 *
 * Manifests on www.crunchyroll.com, three observed families only:
 * - hard-sub /playback/v2/manifest/{mediaId}/static/{asset}/0/{locale}/dash/manifest.mpd
 *   including /0/en-US and /0/enUS. Caption capability stays false.
 * - clean /playback/v2/manifest/{mediaId}/static/{asset}/1/clean/dash/manifest.mpd
 * - modern /playback/v2/manifest/{mediaId}/static/majin/{asset}/{locale}/cenc/dash/manifest.mpd
 * Other paths are not clean and are not a modern host rendition.
 *
 * The playback `url` is not the rendition on screen. On 07 Ghost episode 2 it
 * points at /1/clean while Bitmovin getSource().dash is /0/en-US. burnedInLocale
 * "" is not clean. getSource() also has drm, options, and analytics; only dash
 * is read. Manifests are never selected or rewritten.
 *
 * Modern Bitmovin exposes subtitles.list/enable/disable and no getSubtitle.
 * Those tracks are host delivery. The track URL may carry a `t` query; identity
 * is the CDN origin, path, and asset, and the published track is id/lang/label/kind
 * only. The signed URL is not fetched and is not copied into the snapshot.
 * ASS files are overlaid only when the playing rendition is /1/clean, the file
 * has no query, and the host text renderer is absent or every listed track is
 * explicitly disabled. An active or unreadable renderer is not overlaid.
 * Hard-sub /0/{locale} never overlays ASS, even when playback lists subtitle files.
 * Live subtitle URLs are signed. A signed ASS fetch is not implemented; a clean
 * rendition with only signed ASS degrades to no overlay track.
 *
 * Playback fields used for files are `assetId`, `subtitles` / `captions`, and
 * `bifs` / `bif`. `assetId` must equal the asset embedded in `url` or
 * `hardSubs.*.url` for this media id. Other strings in the document are ignored,
 * including token, drm, and account fields. `bifs` keeps its `t` query for the
 * MAIN-world fetch only; the content snapshot receives the blob URL, not the
 * signed URL. Chapters are only validated intro/credits. CMS titles use the
 * object whose id matches, including a top-level data array.
 */

export const MAX_CRUNCHYROLL_BIF_BYTES = 16 * 1024 * 1024;
/** Selectable host rows already stop at 40. An owned Off may name each of them once. */
export const MAX_CRUNCHYROLL_OWNED_CAPTION_TRACKS = 40;
const MAX_CAPTION_CHARS = 2 * 1024 * 1024;
const MAX_CHAPTER_SECONDS = 12 * 60 * 60;
const MEDIA_ID = /^[A-Za-z0-9]{9}$/;
const HOST_TRACK_ID = /^[A-Za-z0-9_.:-]{1,80}$/;
const CAPTION_REQUEST_ID = /^te-cr-[a-z0-9-]{8,40}$/;
const SITE_SUFFIX = /\s*[|–—-]\s*(?:Watch on\s+)?Crunchyroll\s*$/i;
const GENERIC_TITLE = /^(?:crunchyroll|watch|home|browse|login|sign in|sign up)$/i;
const LANDING_TITLE = /^crunchyroll:\s*watch popular anime,\s*play games\s*&\s*shop online$/i;
const ASSET = '([A-Za-z0-9]{16,32})';
const LOCALE = '([A-Za-z]{2,8}(?:-[A-Za-z0-9]{2,8}){0,2})';
const MEDIA = '([A-Za-z0-9]{9})';
const HARDSUB_PATH = new RegExp(`^/playback/v2/manifest/${MEDIA}/static/${ASSET}/0/${LOCALE}/dash/manifest\\.mpd$`, 'i');
const CLEAN_PATH = new RegExp(`^/playback/v2/manifest/${MEDIA}/static/${ASSET}/1/clean/dash/manifest\\.mpd$`, 'i');
const HOST_PATH = new RegExp(`^/playback/v2/manifest/${MEDIA}/static/majin/${ASSET}/${LOCALE}/cenc/dash/manifest\\.mpd$`, 'i');
const WINDOW_LABELS: Record<string, string> = { intro: 'Intro', credits: 'Credits' };

export const CRUNCHYROLL_CAPTION_EVENT = 'theater-everywhere-crunchyroll-caption';
export const CRUNCHYROLL_CAPTION_ACK_EVENT = 'theater-everywhere-crunchyroll-caption-ack';

export type CrunchyrollRendition = 'unknown' | 'hardsub' | 'clean' | 'host';
export type CrunchyrollHostRenderer = 'absent' | 'suppressed' | 'active' | 'unknown';

export type CrunchyrollCaption = {
  id: string;
  language: string;
  label: string;
  kind: 'captions' | 'subtitles';
  format: 'ass' | 'vtt';
  url: string;
};

export type CrunchyrollHostTrack = {
  id: string;
  language: string;
  label: string;
  kind: 'captions' | 'subtitles';
  enabled: boolean;
};

export type CrunchyrollSnapshot = {
  mediaId: string;
  title?: string;
  rendition: CrunchyrollRendition;
  captionTracks: CrunchyrollCaption[];
  hostTracks: CrunchyrollHostTrack[];
  hostRenderer: CrunchyrollHostRenderer;
  chapters: Chapter[];
  bifBlobUrl?: string;
};

export type CrunchyrollPlayback = {
  assetIds: string[];
  softTracks: CrunchyrollCaption[];
  burnedHint: boolean;
  bifUrl?: string;
};

export type CrunchyrollManifestHit = {
  mediaId: string;
  assetId: string;
  rendition: Exclude<CrunchyrollRendition, 'unknown'>;
};

export type CrunchyrollCaptionRequest = {
  requestId: string;
  mediaId: string;
  route: string;
  trackId: string | null;
  /** First id in ownedTrackIds. Disable it only when it is still the sole live selection. */
  ownedTrackId?: string;
  /** Second id in ownedTrackIds, when a cleanup names more than one RTE track. */
  priorOwnedTrackId?: string;
  /**
   * Every unsettled RTE enable and the previously confirmed track this Off may
   * disable. At most one entry per selectable host row. Not ownership.
   */
  ownedTrackIds?: string[];
};

export type CrunchyrollCaptionAck = {
  requestId: string;
  ok: boolean;
  mediaId: string;
  route: string;
  trackId: string | null;
  /** Automatic Off left a different host track enabled. */
  kept?: boolean;
};

export function crunchyrollMediaId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  return MEDIA_ID.test(id) ? id.toUpperCase() : null;
}

export function crunchyrollContentTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = sanitizeContentTitle(value.replace(SITE_SUFFIX, '').replace(/<[^>]*>/g, ' '));
  if (!cleaned || GENERIC_TITLE.test(cleaned) || LANDING_TITLE.test(cleaned)) return null;
  return cleaned;
}

function unsafeUrl(value: string): boolean {
  return value.includes('..') || /%2e/i.test(value) || value.includes('\\');
}

function hostName(hostname: string): string {
  return hostname.replace(/\.$/, '').toLowerCase();
}

function pathMediaId(pathname: string): string | null {
  for (const part of pathname.split('/')) {
    const id = crunchyrollMediaId(part.split('.')[0]);
    if (id) return id;
  }
  return null;
}

export function classifyCrunchyrollManifest(value: string, mode: 'player' | 'network'): CrunchyrollManifestHit | null {
  if (typeof value !== 'string' || !value || unsafeUrl(value)) return null;
  let pathname = '';
  if (value.startsWith('/')) {
    if (mode === 'network') return null;
    pathname = value.split(/[?#]/)[0];
  } else {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return null;
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    if (hostName(url.hostname) !== 'www.crunchyroll.com') return null;
    pathname = url.pathname;
  }
  const hard = pathname.match(HARDSUB_PATH);
  const clean = pathname.match(CLEAN_PATH);
  const host = pathname.match(HOST_PATH);
  const match = hard || clean || host;
  if (!match?.[1] || !match[2]) return null;
  const mediaId = crunchyrollMediaId(match[1]);
  if (!mediaId) return null;
  const rendition: CrunchyrollManifestHit['rendition'] = hard ? 'hardsub' : clean ? 'clean' : 'host';
  return { mediaId, assetId: match[2].toLowerCase(), rendition };
}

export function crunchyrollDashPath(source: unknown): string | null {
  if (!source || typeof source !== 'object') return null;
  const record = source as { getSource?: () => unknown; dash?: unknown };
  let dashSource: unknown = record;
  if (typeof record.getSource === 'function') {
    try {
      dashSource = record.getSource();
    } catch {
      return null;
    }
  }
  if (!dashSource || typeof dashSource !== 'object') return null;
  const dash = (dashSource as { dash?: unknown }).dash;
  return typeof dash === 'string' ? dash : null;
}

export function crunchyrollMetadataRef(value: string): { kind: 'cms' | 'playback' | 'skip'; mediaId: string } | null {
  if (typeof value !== 'string' || unsafeUrl(value)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  const path = url.pathname;
  if (/\/(?:auth|token|login|account|license|drm)(?:\/|$)/i.test(path)) return null;
  if (hostName(url.hostname) === 'static.crunchyroll.com') {
    const skip = path.match(/^\/skip-events\/production\/([A-Za-z0-9]{9})\.json$/i);
    const mediaId = skip ? crunchyrollMediaId(skip[1]) : null;
    return mediaId ? { kind: 'skip', mediaId } : null;
  }
  if (hostName(url.hostname) !== 'www.crunchyroll.com') return null;
  if (/\.(?:mpd|m3u8|mp4|bif)$/i.test(path)) return null;
  const playback = path.match(/^\/playback\/v3\/([A-Za-z0-9]{9})\/web\/chrome\/play$/i);
  if (playback) {
    const mediaId = crunchyrollMediaId(playback[1]);
    return mediaId ? { kind: 'playback', mediaId } : null;
  }
  if (!path.startsWith('/content/v2/cms/')) return null;
  const mediaId = pathMediaId(path);
  return mediaId ? { kind: 'cms', mediaId } : null;
}

function boundedWindow(value: unknown, key: string): { start: number; end: number; title: string } | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (row.type != null && row.type !== key) return null;
  if (typeof row.start !== 'number' || typeof row.end !== 'number') return null;
  if (!Number.isFinite(row.start) || !Number.isFinite(row.end)) return null;
  if (row.start < 0 || row.end <= row.start || row.end > MAX_CHAPTER_SECONDS) return null;
  const label = WINDOW_LABELS[key];
  if (!label) return null;
  return { start: row.start, end: row.end, title: crunchyrollContentTitle(row.title) || label };
}

/** Returns null when mediaId does not match. An empty list means the document had no usable windows. */
export function parseCrunchyrollSkipEvents(data: unknown, mediaId: string): Chapter[] | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  if (crunchyrollMediaId(record.mediaId) !== mediaId) return null;
  const chapters: Chapter[] = [];
  for (const key of ['intro', 'credits'] as const) {
    const window = boundedWindow(record[key], key);
    if (!window) continue;
    chapters.push({ start: window.start, end: window.end, title: window.title, source: 'crunchyroll', confidence: 'high' });
  }
  chapters.sort((left, right) => left.start - right.start);
  return chapters;
}

export function parseCrunchyrollCmsTitle(data: unknown, mediaId: string): string | null {
  const found: string[] = [];
  const visit = (node: unknown, depth: number) => {
    if (found.length || depth > 6 || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node.slice(0, 30)) visit(item, depth + 1);
      return;
    }
    const record = node as Record<string, unknown>;
    if (crunchyrollMediaId(record.id) === mediaId) {
      const title = crunchyrollContentTitle(record.title);
      if (title) {
        found.push(title);
        return;
      }
    }
    for (const key of ['data', 'items', 'objects', 'episodes', 'result']) visit(record[key], depth + 1);
  };
  visit(data, 0);
  return found[0] || null;
}

function manifestAsset(value: unknown, mediaId: string): string | null {
  if (typeof value !== 'string' || !value) return null;
  const hit = classifyCrunchyrollManifest(value, value.startsWith('/') ? 'player' : 'network');
  return hit?.mediaId === mediaId ? hit.assetId : null;
}

function collectManifestAssets(record: Record<string, unknown>, mediaId: string, assets: Set<string>): void {
  const own = manifestAsset(record.url, mediaId);
  if (own) assets.add(own);
  const hardSubs = record.hardSubs;
  if (!hardSubs || typeof hardSubs !== 'object' || Array.isArray(hardSubs)) return;
  for (const value of Object.values(hardSubs as Record<string, unknown>).slice(0, 20)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const asset = manifestAsset((value as { url?: unknown }).url, mediaId);
    if (asset) assets.add(asset);
  }
}

function declaredAsset(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const id = value.trim().toLowerCase();
  return /^[a-z0-9]{16,32}$/.test(id) ? id : null;
}

function nestedUrl(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const url = (value as { url?: unknown }).url;
  return typeof url === 'string' ? url : null;
}

function localeLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{2,8}){0,2}$/.test(text) ? text : null;
}

function eachLocalized(value: unknown, visit: (url: string, language: string | null) => void): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 40)) {
      const url = nestedUrl(item);
      if (!url) continue;
      const language = item && typeof item === 'object' && !Array.isArray(item)
        ? localeLabel((item as { language?: unknown }).language) || localeLabel((item as { lang?: unknown }).lang)
        : null;
      visit(url, language);
    }
    return;
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 40)) {
    const url = nestedUrl(item);
    if (!url) continue;
    visit(url, localeLabel(key));
  }
}

function firstSignedBif(value: unknown, assetId: string): string | undefined {
  const urls: string[] = [];
  if (typeof value === 'string') urls.push(value);
  else if (Array.isArray(value)) {
    for (const item of value.slice(0, 8)) {
      const url = nestedUrl(item);
      if (url) urls.push(url);
    }
  } else {
    const url = nestedUrl(value);
    if (url) urls.push(url);
  }
  return urls.find((url) => {
    const file = crunchyrollCdnFile(url);
    return file?.kind === 'bif' && file.query === 't' && file.assetId === assetId && isCrunchyrollBifFileUrl(url, assetId);
  });
}

export function parseCrunchyrollPlayback(data: unknown, mediaId: string): CrunchyrollPlayback | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  const embedded = crunchyrollMediaId(record.mediaId) || crunchyrollMediaId(record.media_id);
  if (embedded && embedded !== mediaId) return null;
  const recognized = 'hardSubs' in record
    || 'burnedInLocale' in record
    || typeof record.url === 'string'
    || typeof record.assetId === 'string'
    || 'subtitles' in record
    || 'captions' in record
    || 'bifs' in record
    || 'bif' in record;
  if (!recognized) return null;
  const assets = new Set<string>();
  collectManifestAssets(record, mediaId, assets);
  const assetId = declaredAsset(record.assetId);
  const bound = assetId && assets.has(assetId) ? assetId : null;
  const softTracks: CrunchyrollCaption[] = [];
  if (bound) {
    for (const key of ['subtitles', 'captions'] as const) {
      eachLocalized(record[key], (url, language) => {
        const file = crunchyrollCdnFile(url);
        if (file?.kind !== 'ass' || file.query !== 'none' || file.assetId !== bound) return;
        if (softTracks.some((track) => track.url === url)) return;
        const trackLanguage = language || file.language || 'und';
        softTracks.push({
          id: `crunchyroll:${mediaId}:subtitles:${trackLanguage}:${softTracks.length}`,
          language: trackLanguage,
          label: trackLanguage,
          kind: 'subtitles',
          format: 'ass',
          url
        });
      });
    }
  }
  const burned = typeof record.burnedInLocale === 'string' ? record.burnedInLocale.trim() : '';
  return {
    assetIds: [...assets],
    softTracks,
    burnedHint: Boolean(burned),
    bifUrl: bound ? firstSignedBif(record.bifs, bound) || firstSignedBif(record.bif, bound) : undefined
  };
}

export function parseCrunchyrollHostList(value: unknown, playingAsset: string | null): {
  tracks: CrunchyrollHostTrack[];
  renderer: CrunchyrollHostRenderer;
} {
  if (!Array.isArray(value)) return { tracks: [], renderer: 'unknown' };
  if (value.length === 0) return { tracks: [], renderer: 'absent' };
  let sawEnabled = false;
  let sawUnknown = false;
  const tracks: CrunchyrollHostTrack[] = [];
  for (const item of value.slice(0, 40)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      sawUnknown = true;
      continue;
    }
    const row = item as Record<string, unknown>;
    if (row.enabled === true) sawEnabled = true;
    else if (row.enabled !== false) sawUnknown = true;
    if (row.forced === true) continue;
    const id = typeof row.id === 'string' && HOST_TRACK_ID.test(row.id) ? row.id : '';
    const url = typeof row.url === 'string' ? row.url : '';
    const file = url ? crunchyrollCdnFile(url) : null;
    if (!id || file?.kind !== 'vtt' || !playingAsset || file.assetId !== playingAsset.toLowerCase()) continue;
    if (tracks.some((track) => track.id === id)) continue;
    const kindText = String(row.kind || '').toLowerCase();
    const language = typeof row.lang === 'string' && row.lang.trim() ? row.lang.trim() : (file.language || 'und');
    tracks.push({
      id,
      language,
      label: crunchyrollContentTitle(row.label) || language,
      kind: kindText === 'caption' || kindText === 'captions' ? 'captions' : 'subtitles',
      enabled: row.enabled === true
    });
  }
  const renderer: CrunchyrollHostRenderer = sawEnabled ? 'active' : sawUnknown ? 'unknown' : 'suppressed';
  return { tracks, renderer };
}

export function crunchyrollOverlayTracks(
  rendition: CrunchyrollRendition,
  renderer: CrunchyrollHostRenderer,
  hostTracks: CrunchyrollHostTrack[],
  softTracks: CrunchyrollCaption[]
): CrunchyrollCaption[] {
  if (rendition !== 'clean' || hostTracks.length > 0) return [];
  if (renderer !== 'absent' && renderer !== 'suppressed') return [];
  return softTracks;
}

export function crunchyrollHostDeliveryTracks(
  rendition: CrunchyrollRendition,
  hostTracks: CrunchyrollHostTrack[]
): CrunchyrollHostTrack[] {
  if (rendition !== 'host' && rendition !== 'clean') return [];
  return hostTracks;
}

export function crunchyrollCaptionRequestId(): string {
  return `te-cr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function crunchyrollCaptionRequestDetail(request: CrunchyrollCaptionRequest): string {
  return JSON.stringify(request);
}

/** Long enough for the max route plus 40 host track ids, and no larger. */
const MAX_CAPTION_REQUEST_CHARS = 8192;

function parseOwnedCaptionIds(record: Record<string, unknown>): {
  ownedTrackId: string;
  priorOwnedTrackId?: string;
  ownedTrackIds: string[];
} | null | undefined {
  const hasList = record.ownedTrackIds != null;
  const hasOwned = record.ownedTrackId != null;
  const hasPrior = record.priorOwnedTrackId != null;
  if (!hasList && !hasOwned && !hasPrior) return undefined;
  if (hasPrior && !hasOwned && !hasList) return null;
  let ids: string[] | null = null;
  if (hasList) {
    if (!Array.isArray(record.ownedTrackIds)) return null;
    if (record.ownedTrackIds.length < 1 || record.ownedTrackIds.length > MAX_CRUNCHYROLL_OWNED_CAPTION_TRACKS) return null;
    ids = [];
    for (const id of record.ownedTrackIds) {
      if (typeof id !== 'string' || !HOST_TRACK_ID.test(id) || ids.includes(id)) return null;
      ids.push(id);
    }
  }
  if (hasOwned) {
    if (typeof record.ownedTrackId !== 'string' || !HOST_TRACK_ID.test(record.ownedTrackId)) return null;
    if (ids && record.ownedTrackId !== ids[0]) return null;
    if (!ids) ids = [record.ownedTrackId];
  }
  if (!ids) return null;
  if (hasPrior) {
    if (typeof record.priorOwnedTrackId !== 'string' || !HOST_TRACK_ID.test(record.priorOwnedTrackId)) return null;
    if (record.priorOwnedTrackId === ids[0]) {
      if (hasList) return null;
    } else if (!hasList) {
      ids.push(record.priorOwnedTrackId);
    } else if (ids[1] !== record.priorOwnedTrackId) return null;
  }
  return {
    ownedTrackId: ids[0],
    ...(ids.length > 1 ? { priorOwnedTrackId: ids[1] } : {}),
    ownedTrackIds: ids
  };
}

export function parseCrunchyrollCaptionRequest(detail: unknown): CrunchyrollCaptionRequest | null {
  if (typeof detail !== 'string' || detail.length > MAX_CAPTION_REQUEST_CHARS) return null;
  let data: unknown;
  try {
    data = JSON.parse(detail);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  if (typeof record.requestId !== 'string' || !CAPTION_REQUEST_ID.test(record.requestId)) return null;
  const mediaId = crunchyrollMediaId(record.mediaId);
  if (!mediaId || typeof record.route !== 'string' || record.route.length > 400) return null;
  if (record.trackId === null) {
    const owned = parseOwnedCaptionIds(record);
    if (owned === null) return null;
    return { requestId: record.requestId, mediaId, route: record.route, trackId: null, ...owned };
  }
  if (typeof record.trackId !== 'string' || !HOST_TRACK_ID.test(record.trackId)) return null;
  return { requestId: record.requestId, mediaId, route: record.route, trackId: record.trackId };
}

export function crunchyrollCaptionAckDetail(ack: CrunchyrollCaptionAck): string {
  return JSON.stringify(ack);
}

export function parseCrunchyrollCaptionAck(detail: unknown): CrunchyrollCaptionAck | null {
  if (typeof detail !== 'string' || detail.length > 900) return null;
  let data: unknown;
  try {
    data = JSON.parse(detail);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  const request = parseCrunchyrollCaptionRequest(JSON.stringify({
    requestId: record.requestId,
    mediaId: record.mediaId,
    route: record.route,
    trackId: record.trackId ?? null
  }));
  if (!request || typeof record.ok !== 'boolean') return null;
  if ('kept' in record && typeof record.kept !== 'boolean') return null;
  return { ...request, ok: record.ok, ...(record.kept === true ? { kept: true } : {}) };
}

export function parseCrunchyrollCaptionBody(body: string, format: string): CaptionCue[] {
  if (!body || body.length > MAX_CAPTION_CHARS) return [];
  const kind = format.toLowerCase();
  if (kind === 'ass' || kind === 'ssa' || body.includes('Dialogue:')) {
    const cues = parseBilibiliIntlCaptions(body);
    if (cues.length) return cues;
  }
  return parseCaptionPayload(body);
}

export function summarizeCrunchyrollBif(buffer: ArrayBuffer): { frames: number; intervalMs: number | null } | null {
  if (buffer.byteLength < 64 || buffer.byteLength > MAX_CRUNCHYROLL_BIF_BYTES) return null;
  const parsed = parseRokuBif(buffer);
  if (!parsed?.frames.length) return null;
  const delta = parsed.frames.length > 1 ? parsed.frames[1].time - parsed.frames[0].time : Number.NaN;
  const intervalMs = Number.isFinite(delta) && delta > 0 ? Math.round(delta * 1000) : null;
  return { frames: parsed.frames.length, intervalMs };
}
