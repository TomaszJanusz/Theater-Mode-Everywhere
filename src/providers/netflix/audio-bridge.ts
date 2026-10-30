import { normalizeLanguageTag } from '../../media-features/audio-preference';
import type { AudioTrack, AudioTrackList } from '../../media-features/types';

export const AUDIO_QUERY = 'theater-everywhere-netflix-audio-query';
export const AUDIO_SELECT = 'theater-everywhere-netflix-audio-select';
export const AUDIO_STOP = 'theater-everywhere-netflix-audio-stop';
export const AUDIO_CHANGE = 'theater-everywhere-netflix-audio-change';
export const AUDIO_ACK = 'theater-everywhere-netflix-audio-ack';
export const AUDIO_SNAPSHOT = 'theater-everywhere-netflix-audio';
export const AUDIO_TIMEOUT = 5000;
export const AUDIO_EVENTS = ['audiotrackchanged', 'audiotracklistchanged', 'loadedtracks', 'adsstatechanged', 'busychanged', 'timedtexttracklistchanged', 'timedtexttrackchanged'] as const;

export type AudioRequest = { requestId: string; clientId: string; pageHref: string; mediaId: string };
export type AudioQuery = AudioRequest & { observe: boolean };
export type AudioSelect = AudioRequest & { bindingId: string; trackId: string };
export type AudioSnapshot = AudioRequest & { bindingId: string; list: AudioTrackList | null };
export type AudioAck = AudioSelect & { ok: boolean };

const bounded = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max;
const token = (value: unknown): value is string => bounded(value, 80) && /^[\w:-]+$/.test(value);
export const validTrackId = (value: unknown): value is string => bounded(value, 600) && value.length > 0;

function readJson(raw: unknown, max: number): Record<string, unknown> | null {
  if (!bounded(raw, max)) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}

function validRequest(data: Record<string, unknown>): boolean {
  return token(data.requestId) && token(data.clientId) && bounded(data.pageHref, 2048)
    && typeof data.mediaId === 'string' && /^\d{1,12}$/.test(data.mediaId);
}

export function parseAudioQuery(raw: unknown): AudioQuery | null {
  const data = readJson(raw, 2600);
  return data && validRequest(data) && typeof data.observe === 'boolean' ? data as AudioQuery : null;
}

export function parseAudioSelect(raw: unknown): AudioSelect | null {
  const data = readJson(raw, 3400);
  return data && validRequest(data) && token(data.bindingId) && validTrackId(data.trackId) ? data as AudioSelect : null;
}

function matches(data: Record<string, unknown>, expected: AudioRequest): boolean {
  return validRequest(data) && data.requestId === expected.requestId && data.clientId === expected.clientId
    && data.pageHref === expected.pageHref && data.mediaId === expected.mediaId;
}

function validTrack(value: unknown): value is AudioTrack {
  if (!value || typeof value !== 'object') return false;
  const track = value as Record<string, unknown>;
  return validTrackId(track.id) && bounded(track.label, 200) && bounded(track.languageTag, 35)
    && (!track.languageTag || normalizeLanguageTag(track.languageTag) === track.languageTag)
    && ['original', 'dub', 'description', 'commentary', 'unknown'].includes(String(track.kind)) && typeof track.selected === 'boolean';
}

export function parseAudioSnapshot(raw: unknown, expected: AudioRequest): AudioSnapshot | null {
  const data = readJson(raw, 60_000);
  if (!data || !matches(data, expected) || !token(data.bindingId)) return null;
  if (data.list === null) return data as AudioSnapshot;
  const list = data.list as Partial<AudioTrackList> | undefined;
  if (!list || list.mediaId !== expected.mediaId || typeof list.blocked !== 'boolean'
    || !Array.isArray(list.tracks) || list.tracks.length > 100 || !list.tracks.every(validTrack)) return null;
  if (new Set(list.tracks.map(track => track.id)).size !== list.tracks.length || list.tracks.filter(track => track.selected).length > 1) return null;
  return data as AudioSnapshot;
}

export function parseAudioAck(raw: unknown, expected: AudioSelect): AudioAck | null {
  const data = readJson(raw, 3500);
  return data && matches(data, expected) && data.bindingId === expected.bindingId
    && data.trackId === expected.trackId && typeof data.ok === 'boolean' ? data as AudioAck : null;
}

/** Only these public fields leave MAIN. No playback/manifest identifiers or host objects. */
export function netflixAudioTrack(raw: unknown, selected: unknown): AudioTrack | null {
  if (!raw || typeof raw !== 'object') return null;
  const track = raw as Record<string, unknown>;
  if (!validTrackId(track.trackId) || !bounded(track.displayName, 200)) return null;
  const type = track.trackType;
  // ASSISTIVE wins even if a malformed host marks the descriptive recording native.
  const kind = type === 'ASSISTIVE' ? 'description' : type === 'COMMENTARY' || track.rawTrackType === 'COMMENTARY'
    ? 'commentary' : type === 'PRIMARY' ? track.isNative === true ? 'original' : 'dub' : 'unknown';
  return { id: track.trackId, label: track.displayName, languageTag: normalizeLanguageTag(track.bcp47) ?? '', kind, selected: raw === selected };
}
