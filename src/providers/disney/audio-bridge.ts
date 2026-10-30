import { normalizeLanguageTag } from '../../media-features/audio-preference';
import type { AudioTrack } from '../../media-features/types';

/**
 * Disney+ audio crosses worlds like YouTube's: a string-only query that MAIN answers synchronously
 * in hidden JSON, and a selection request that MAIN revalidates against the live Hive player.
 * Unlike YouTube, Hive confirms a switch only after it has reloaded the media, so the answer
 * arrives later as a JSON-string event. A watch lease keeps MAIN's state-store subscription alive
 * only while a theater adapter observes it. MAIN reads `disney-web-player`'s `mediaPlayer.audio`
 * (`availableTracks`, `selectedTrack`, `setTrack`), which the native Audio menu also uses; that
 * menu lives in a closed shadow root and builds its list only when opened.
 */
export const DISNEY_AUDIO_QUERY = 'theater-everywhere-disney-audio-query';
export const DISNEY_AUDIO_SELECT = 'theater-everywhere-disney-audio-select';
export const DISNEY_AUDIO_RESULT = 'theater-everywhere-disney-audio-result';
export const DISNEY_AUDIO_WATCH = 'theater-everywhere-disney-audio-watch';
export const DISNEY_AUDIO_CHANGE = 'theater-everywhere-disney-audio-change';
export const DISNEY_AUDIO_SNAPSHOT = 'theater-everywhere-disney-audio';

export const MAX_DISNEY_AUDIO_TRACKS = 64;
/** Hive reloads the media before it reports the new track, about 1.5 s on a fast connection. */
export const DISNEY_AUDIO_TIMEOUT_MS = 8_000;
const MAX_SNAPSHOT_CHARS = 30_000;
const MAX_MESSAGE_CHARS = 400;

/** The fields MAIN copies from one Hive track; the isolated world interprets them. */
export type DisneyAudioRecord = {
  /** `String(track.id)`, Hive's own id. */
  id: string;
  /** `displayName.title`, the endonym Disney's menu shows ("Polski"), else the English `name`. */
  label: string;
  /** `language`, such as `pl` or `es-419`. */
  language: string;
  /** `hasDescribesVideo`: an audio description track. */
  description: boolean;
  selected: boolean;
};

/** `bindingId` names the Hive player object, so a pick on a replaced one is retired, not refused. */
export type DisneyAudioSnapshot = { requestId: string; pageHref: string; playId: string; bindingId: string; tracks: DisneyAudioRecord[] };
export type DisneyAudioSelect = { requestId: string; playId: string; trackId: string; keepPaused: boolean };
export type DisneyAudioResult = { requestId: string; ok: boolean };
export type DisneyAudioWatch = { watchId: string; on: boolean };

const PLAY_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const isRequestId = (value: unknown): value is string => typeof value === 'string' && /^[\w:-]{1,80}$/.test(value);
export const isDisneyAudioTrackId = (value: unknown): value is string => typeof value === 'string' && /^[\w.:-]{1,40}$/.test(value);
export const isDisneyPlayId = (value: unknown): value is string => typeof value === 'string' && PLAY_ID_RE.test(value);
const boundedString = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max;

/** The `/play/<uuid>` id both worlds key the item by, as the MAIN clock does; a locale prefix is allowed. */
export function disneyAudioPlayId(href: string): string | null {
  try {
    const match = new URL(href).pathname.match(/\/play\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    return match ? match[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

function parseObject(raw: unknown, max: number): Record<string, unknown> | null {
  if (typeof raw !== 'string' || raw.length > max) return null;
  try {
    const data: unknown = JSON.parse(raw);
    return data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function validRecord(value: unknown): value is DisneyAudioRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return isDisneyAudioTrackId(record.id) && boundedString(record.label, 200) && boundedString(record.language, 35)
    && typeof record.description === 'boolean' && typeof record.selected === 'boolean';
}

/** MAIN's snapshot, accepted only for this request, this page and a well-formed track list. */
export function parseDisneyAudioSnapshot(text: string | null | undefined, requestId: string, pageHref: string): DisneyAudioSnapshot | null {
  const data = parseObject(text, MAX_SNAPSHOT_CHARS);
  if (!data || data.requestId !== requestId || data.pageHref !== pageHref || !isDisneyPlayId(data.playId)) return null;
  if (typeof data.bindingId !== 'string' || !/^\d{1,9}$/.test(data.bindingId)) return null;
  const tracks = data.tracks;
  if (!Array.isArray(tracks) || tracks.length > MAX_DISNEY_AUDIO_TRACKS || !tracks.every(validRecord)) return null;
  return { requestId, pageHref, playId: data.playId, bindingId: data.bindingId, tracks };
}

export function parseDisneyAudioSelect(raw: unknown): DisneyAudioSelect | null {
  const data = parseObject(raw, MAX_MESSAGE_CHARS);
  if (!data || !isRequestId(data.requestId) || !isDisneyPlayId(data.playId) || !isDisneyAudioTrackId(data.trackId)
    || typeof data.keepPaused !== 'boolean') return null;
  return { requestId: data.requestId, playId: data.playId, trackId: data.trackId, keepPaused: data.keepPaused };
}

export function parseDisneyAudioResult(raw: unknown): DisneyAudioResult | null {
  const data = parseObject(raw, MAX_MESSAGE_CHARS);
  return data && isRequestId(data.requestId) && typeof data.ok === 'boolean' ? { requestId: data.requestId, ok: data.ok } : null;
}

export function parseDisneyAudioWatch(raw: unknown): DisneyAudioWatch | null {
  const data = parseObject(raw, MAX_MESSAGE_CHARS);
  return data && isRequestId(data.watchId) && typeof data.on === 'boolean' ? { watchId: data.watchId, on: data.on } : null;
}

/**
 * Tracks as the menu offers them. Hive marks audio description but not the original recording:
 * `targetLanguage` in its playback criteria only suggests it, so other tracks stay `unknown`
 * rather than a guessed `original` or `dub`. A description track that would show the same label
 * as a regular one gets none, so the menu names it "<language> (audio description)" instead.
 * Ids the host repeats are dropped: a selection could not tell those tracks apart.
 */
export function disneyAudioTracks(records: readonly DisneyAudioRecord[]): AudioTrack[] {
  const counts = new Map<string, number>();
  for (const record of records) counts.set(record.id, (counts.get(record.id) ?? 0) + 1);
  const unique = records.filter(record => counts.get(record.id) === 1);
  const plainLabels = new Set(unique.filter(record => !record.description).map(record => record.label.trim().toLowerCase()));
  return unique.map(record => {
    const label = record.label.trim();
    return {
      id: record.id,
      languageTag: normalizeLanguageTag(record.language) ?? '',
      label: record.description && plainLabels.has(label.toLowerCase()) ? '' : label,
      kind: record.description ? 'description' : 'unknown',
      selected: record.selected
    };
  });
}
