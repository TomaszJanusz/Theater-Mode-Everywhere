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
  selectedTrackId?: string | null;
  tracks: Array<Pick<NetflixTextTrack, 'id' | 'kind' | 'forced' | 'none'>>;
}): string {
  return JSON.stringify({
    videoId: state.videoId ?? null,
    title: state.title ?? null,
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
    const tracks = parsePublishedNetflixTracks(data.tracks);
    const selectedTrackId = netflixTrackId(data.selectedTrackId) || undefined;
    if (!videoId && !title && tracks.length === 0) return null;
    return {
      ...(videoId ? { videoId } : {}),
      ...(title ? { title } : {}),
      tracks,
      ...(selectedTrackId ? { selectedTrackId } : {})
    };
  } catch {
    return null;
  }
}
