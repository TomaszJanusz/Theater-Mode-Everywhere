import { sanitizeContentTitle } from '../content-title';

export const NETFLIX_SNAPSHOT_ID = 'theater-everywhere-netflix-snapshot';
export const NETFLIX_CAPTION_EVENT = 'theater-everywhere-netflix-caption';
export const NETFLIX_CAPTION_ACK_EVENT = 'theater-everywhere-netflix-caption-ack';
export const NETFLIX_HARVEST_EVENT = 'theater-everywhere-netflix-harvest';

const TRACK_ID_RE = /^[A-Za-z0-9:_;.\-]{1,80}$/;
const CAPTION_REQUEST_ID_RE = /^te-nf-[a-z0-9-]{8,60}$/;
const OFF_LABEL_RE = /^(?:off|none|wył\.?|wyl\.?|wyłączone|wylaczone|aus|desactivado|désactivé|desactive|spento|オフ|끄기|выкл\.?|вимк\.?|关闭|關)$/i;
const SITE_TITLE_SUFFIX_RE = /\s*[|–—-]\s*(?:oficjalna witryna netflix|official (?:site|website)|site officiel|sitio oficial|sito ufficiale|offizielle webseite|netflix)$/i;
const SITE_TITLE_PREFIX_RE = /^(?:oglądaj|ogladaj|watch|regarder|schauen|ver|mira|assistir|смотреть|дивіться|观看|視聴)\s*:\s*/i;
const GENERIC_TITLE_RE = /^(?:netflix|home|sign in|zaloguj się)$/i;

export type NetflixTextTrack = {
  id: string;
  language: string;
  label: string;
  kind: 'subtitles' | 'captions';
  forced: boolean;
  none: boolean;
};

export type NetflixSnapshot = {
  videoId?: string;
  title?: string;
  captions?: boolean;
  tracks: NetflixTextTrack[];
  selectedTrackId?: string;
};

export type NetflixCaptionRequest = {
  requestId: string;
  trackId: string | null;
};

export type NetflixCaptionAck = {
  requestId: string;
  ok: boolean;
};

export function netflixTrackId(value: unknown): string | null {
  if (typeof value !== 'string' || !TRACK_ID_RE.test(value)) return null;
  return value;
}

export function netflixVideoId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return String(Math.trunc(value));
  if (typeof value !== 'string') return null;
  const cleaned = value.trim();
  if (!/^\d{1,12}$/.test(cleaned)) return null;
  return cleaned;
}

export function isNetflixOffTrack(track: { label?: unknown; none?: unknown }): boolean {
  if (track.none === true) return true;
  const label = typeof track.label === 'string' ? track.label.trim() : '';
  return OFF_LABEL_RE.test(label);
}

export function parseNetflixTextTracks(raw: unknown): NetflixTextTrack[] {
  if (!Array.isArray(raw)) return [];
  const tracks: NetflixTextTrack[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const id = netflixTrackId(record.trackId ?? record.id);
    if (!id || seen.has(id)) continue;
    const label = sanitizeContentTitle(record.displayName ?? record.label) || '';
    const language = typeof record.bcp47 === 'string'
      ? record.bcp47.trim().slice(0, 16)
      : (typeof record.language === 'string' ? record.language.trim().slice(0, 16) : '');
    const rawType = typeof record.rawTrackType === 'string' ? record.rawTrackType : '';
    const none = record.isNoneTrack === true || isNetflixOffTrack({ label });
    if (!label && !none) continue;
    seen.add(id);
    tracks.push({
      id,
      language,
      label: label || 'Off',
      kind: /caption/i.test(rawType) ? 'captions' : 'subtitles',
      forced: record.isForcedNarrative === true,
      none
    });
    if (tracks.length >= 40) break;
  }
  return tracks;
}

/** Snapshot JSON uses the normalized fields. The raw player parser must not read it. */
export function parsePublishedNetflixTracks(raw: unknown): NetflixTextTrack[] {
  if (!Array.isArray(raw)) return [];
  const tracks: NetflixTextTrack[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const id = netflixTrackId(record.id);
    if (!id || seen.has(id)) continue;
    const label = sanitizeContentTitle(record.label) || '';
    const language = typeof record.language === 'string' ? record.language.trim().slice(0, 16) : '';
    const none = record.none === true || isNetflixOffTrack({ label, none: record.none });
    if (!label && !none) continue;
    const kind = record.kind === 'captions' || record.kind === 'subtitles' ? record.kind : 'subtitles';
    seen.add(id);
    tracks.push({
      id,
      language,
      label: label || 'Off',
      kind,
      forced: record.forced === true,
      none
    });
    if (tracks.length >= 40) break;
  }
  return tracks;
}

export function selectableNetflixTextTracks(tracks: NetflixTextTrack[]): NetflixTextTrack[] {
  return tracks.filter((track) => !track.none);
}

export function chooseNetflixRawTrack(rawTracks: unknown, trackId: string | null): unknown | null {
  const tracks = parseNetflixTextTracks(rawTracks);
  const target = selectNetflixCaptionTarget(tracks, trackId);
  if (!target || !Array.isArray(rawTracks)) return null;
  for (const item of rawTracks) {
    if (!item || typeof item !== 'object') continue;
    const record = item as { trackId?: unknown; id?: unknown };
    if (record.trackId === target.id || record.id === target.id) return item;
  }
  return null;
}

export type NetflixCaptionApi = {
  textTracks?: unknown;
  selectedTextTrack?: { trackId?: unknown; id?: unknown } | null;
  setTimedTextTrack?: (track: unknown) => unknown;
  getTimedTextTrack?: () => { trackId?: unknown; id?: unknown } | null;
  getTimedTextTrackList?: () => unknown;
};

export function netflixCaptionList(api: NetflixCaptionApi): unknown {
  if (typeof api.getTimedTextTrackList === 'function') {
    try {
      const list = api.getTimedTextTrackList();
      if (Array.isArray(list) && list.length > 0) return list;
    } catch {
      // The HTML5 fallback list getter returns null; props may still hold the array.
    }
  }
  return api.textTracks;
}

function rawTrackKey(track: { trackId?: unknown; id?: unknown } | null | undefined): string | null {
  const key = track?.trackId ?? track?.id;
  return typeof key === 'string' ? key : null;
}

export function netflixLiveTrackId(api: NetflixCaptionApi): string | null {
  let live: { trackId?: unknown; id?: unknown } | null | undefined;
  if (typeof api.getTimedTextTrack === 'function') {
    try {
      live = api.getTimedTextTrack();
    } catch {
      live = null;
    }
  } else {
    live = api.selectedTextTrack;
  }
  return rawTrackKey(live);
}

/**
 * fallbackMode true and an explicit loading state are negatives. Loading wins
 * over a settled uiState or a layout that no longer has the loading class.
 * Unknown loading is a negative too. A mounted renderer means the host may
 * accept a logical track selection. It does not mean a cue was painted.
 */
export function netflixHostCaptionsAvailable(input: {
  rendererMounted: boolean;
  fallbackMode: boolean | null;
  playerLoading: boolean | null;
}): boolean {
  if (input.fallbackMode === true) return false;
  if (input.playerLoading !== false) return false;
  return input.rendererMounted;
}

/**
 * A language is applied only when the same object reports that track id afterwards
 * and host captions are available. That match is a logical selection. It does
 * not mean `.player-timedtext` painted a cue. Off is applied when the live
 * track is the off track.
 */
export function applyNetflixPlayerCaption(
  api: NetflixCaptionApi,
  trackId: string | null,
  rendererMounted: boolean
): boolean {
  if (trackId != null && !rendererMounted) return false;
  const raw = chooseNetflixRawTrack(netflixCaptionList(api), trackId);
  if (!raw || typeof api.setTimedTextTrack !== 'function') return false;
  const requestedId = rawTrackKey(raw as { trackId?: unknown; id?: unknown });
  if (typeof requestedId !== 'string') return false;
  try {
    api.setTimedTextTrack(raw);
  } catch {
    return false;
  }
  return netflixLiveTrackId(api) === requestedId;
}

export function netflixCaptionRequestDetail(request: NetflixCaptionRequest): string {
  return JSON.stringify({ requestId: request.requestId, trackId: request.trackId });
}

export function parseNetflixCaptionRequest(detail: unknown): NetflixCaptionRequest | null {
  if (typeof detail !== 'string' || detail.length > 180) return null;
  let data: unknown;
  try {
    data = JSON.parse(detail);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  if (typeof record.requestId !== 'string' || !CAPTION_REQUEST_ID_RE.test(record.requestId)) return null;
  if (record.trackId === null) return { requestId: record.requestId, trackId: null };
  const trackId = netflixTrackId(record.trackId);
  if (!trackId) return null;
  return { requestId: record.requestId, trackId };
}

export function netflixCaptionAckDetail(ack: NetflixCaptionAck): string {
  return JSON.stringify({ requestId: ack.requestId, ok: ack.ok === true });
}

export function parseNetflixCaptionAck(detail: unknown): NetflixCaptionAck | null {
  if (typeof detail !== 'string' || detail.length > 120) return null;
  let data: unknown;
  try {
    data = JSON.parse(detail);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  if (typeof record.requestId !== 'string' || !CAPTION_REQUEST_ID_RE.test(record.requestId)) return null;
  if (typeof record.ok !== 'boolean') return null;
  return { requestId: record.requestId, ok: record.ok };
}

export function netflixHarvestKey(state: {
  videoId?: string | null;
  title?: string | null;
  captions?: boolean | null;
  selectedTrackId?: string | null;
  tracks: Array<Pick<NetflixTextTrack, 'id' | 'kind' | 'forced' | 'none'>>;
}): string {
  return JSON.stringify({
    videoId: state.videoId ?? null,
    title: state.title ?? null,
    captions: state.captions === true,
    selectedTrackId: state.selectedTrackId ?? null,
    tracks: state.tracks.map((track) => [track.id, track.kind, track.forced === true, track.none === true])
  });
}

export function selectNetflixCaptionTarget(
  tracks: NetflixTextTrack[],
  trackId: string | null
): NetflixTextTrack | null {
  if (trackId == null) return tracks.find((track) => track.none) || null;
  const id = netflixTrackId(trackId);
  if (!id) return null;
  return tracks.find((track) => track.id === id && !track.none) || null;
}

/** Drops a published snapshot when playback moved to a different Netflix video id. */
export function netflixSnapshotMatchesVideo(snapshotVideoId: unknown, activeVideoId: unknown): boolean {
  const snapshot = netflixVideoId(snapshotVideoId);
  const active = netflixVideoId(activeVideoId);
  if (!snapshot || !active) return true;
  return snapshot === active;
}

export function stripNetflixSiteTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const stripped = value.replace(SITE_TITLE_PREFIX_RE, '').replace(SITE_TITLE_SUFFIX_RE, '');
  const cleaned = sanitizeContentTitle(stripped);
  if (!cleaned || GENERIC_TITLE_RE.test(cleaned)) return null;
  return cleaned;
}

/**
 * Title of the clip that is actually open.
 * A changed video id must not keep the previous trailer name.
 */
export function resolveNetflixTitle(input: {
  videoId: string | null;
  previousVideoId: string | null;
  previousTitle: string | null;
  playerTitle: unknown;
  controlTitle: unknown;
  documentTitle: unknown;
}): string | null {
  const sameVideo = Boolean(input.videoId && input.videoId === input.previousVideoId);
  const player = stripNetflixSiteTitle(input.playerTitle);
  if (player) return player;
  const control = stripNetflixSiteTitle(input.controlTitle);
  if (control) return control;
  if (sameVideo && input.previousTitle) return input.previousTitle;
  return stripNetflixSiteTitle(input.documentTitle);
}

export function readPublishedNetflixSnapshot(
  root: Pick<ParentNode, 'querySelector'> | null | undefined = typeof document === 'undefined' ? null : document
): NetflixSnapshot | null {
  if (!root) return null;
  const text = root.querySelector(`#${NETFLIX_SNAPSHOT_ID}`)?.textContent?.trim();
  if (!text) return null;
  try {
    const data = JSON.parse(text) as Record<string, unknown>;
    if (!data || typeof data !== 'object') return null;
    const videoId = netflixVideoId(data.videoId) || undefined;
    const title = stripNetflixSiteTitle(data.title) || undefined;
    const captions = data.captions === false ? false : data.captions === true ? true : undefined;
    const tracks = captions === false ? [] : parsePublishedNetflixTracks(data.tracks);
    const selectedTrackId = captions === false ? undefined : netflixTrackId(data.selectedTrackId) || undefined;
    if (!videoId && !title && tracks.length === 0 && captions !== false) return null;
    return {
      ...(videoId ? { videoId } : {}),
      ...(title ? { title } : {}),
      ...(captions === undefined ? {} : { captions }),
      tracks,
      ...(selectedTrackId ? { selectedTrackId } : {})
    };
  } catch {
    return null;
  }
}
