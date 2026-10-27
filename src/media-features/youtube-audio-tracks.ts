import { normalizeLanguageTag } from './audio-preference';
import type { AudioTrack, AudioTrackKind } from './types';

/**
 * YouTube audio tracks cross worlds the way queue navigation does: a string-only query that MAIN
 * answers synchronously in hidden JSON, a selection request MAIN revalidates against the live
 * player before acting, and a payload-free change ping. MAIN reads the player API
 * (`getAvailableAudioTracks`, `getAudioTrack`, `setAudioTrack` on `#movie_player`) rather than
 * clicking Settings > Audio track: that menu shows only a localized label, needs the native
 * settings popup opened over the theater, and is built from the same track objects.
 */
export const YOUTUBE_AUDIO_QUERY = 'theater-everywhere-youtube-audio-query';
export const YOUTUBE_AUDIO_SELECT = 'theater-everywhere-youtube-audio-select';
export const YOUTUBE_AUDIO_CHANGE = 'theater-everywhere-youtube-audio-change';
export const YOUTUBE_AUDIO_SNAPSHOT = 'theater-everywhere-youtube-audio';
export const YOUTUBE_AUDIO_RESULT = 'theater-everywhere-youtube-audio-result';
export const YOUTUBE_AUDIO_PLAYER_ID = 'movie_player';

const MAX_TRACKS = 100;
const MAX_SNAPSHOT_CHARS = 60_000;

/** The fields MAIN copies from one player track object; the isolated world interprets them. */
export type YouTubeAudioRecord = {
  /** The player's own id: `<itag>;<base64url xtags>`. */
  id: string;
  /** `toString()`, the label of the native menu in the viewer's YouTube language. */
  label: string;
  /** `getLanguageInfo().id`, such as `en-US.4`. */
  languageId: string;
  autoDubbed: boolean;
  selected: boolean;
};

export type YouTubeAudioSnapshot = {
  requestId: string;
  pageHref: string;
  videoId: string;
  ad: boolean;
  tracks: YouTubeAudioRecord[];
};

export type YouTubeAudioSelect = { requestId: string; videoId: string; trackId: string };

const isRequestId = (value: unknown): value is string => typeof value === 'string' && /^[\w:-]{1,80}$/.test(value);
const isVideoId = (value: unknown): value is string => typeof value === 'string' && /^[\w-]{11}$/.test(value);
const boundedString = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max;

/**
 * The id the player keeps for a track across format changes: its xtags, which name the content
 * and language, without the itag of the stream that currently carries it.
 */
export function youtubeAudioTrackKey(record: Pick<YouTubeAudioRecord, 'id' | 'languageId'>): string {
  const separator = record.id.indexOf(';');
  return (separator >= 0 ? record.id.slice(separator + 1) : '') || record.languageId || record.id;
}

/** Key/value pairs of the xtags protobuf (repeated field 1 of {1: key, 2: value}). */
export function parseYoutubeXtags(xtags: string): Map<string, string> {
  const pairs = new Map<string, string>();
  if (!xtags || xtags.length > 1024 || !/^[\w-]+={0,2}$/.test(xtags)) return pairs;
  let bytes: Uint8Array;
  try {
    const base64 = xtags.replace(/-/g, '+').replace(/_/g, '/');
    bytes = Uint8Array.from(atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4)), char => char.charCodeAt(0));
  } catch {
    return pairs;
  }
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const fields = (start: number, end: number, visit: (field: number, from: number, to: number) => boolean): boolean => {
    let at = start;
    while (at < end) {
      const tag = bytes[at++];
      // Only short length-delimited fields occur here; anything else means the format changed.
      if ((tag & 7) !== 2) return false;
      const length = bytes[at++];
      if (length === undefined || length > 127 || at + length > end) return false;
      if (!visit(tag >> 3, at, at + length)) return false;
      at += length;
    }
    return true;
  };
  try {
    fields(0, bytes.length, (field, from, to) => {
      if (field !== 1) return true;
      let key = '';
      let value = '';
      const ok = fields(from, to, (inner, start, end) => {
        const text = decoder.decode(bytes.subarray(start, end));
        if (inner === 1) key = text;
        if (inner === 2) value = text;
        return true;
      });
      if (ok && key) pairs.set(key, value);
      return ok;
    });
  } catch {
    // Invalid UTF-8.
  }
  return pairs;
}

const CONTENT_KINDS: Record<string, AudioTrackKind> = {
  original: 'original',
  dubbed: 'dub',
  'dubbed-auto': 'dub',
  descriptive: 'description'
};

export function youtubeAudioTrack(record: YouTubeAudioRecord): AudioTrack {
  const key = youtubeAudioTrackKey(record);
  const separator = record.id.indexOf(';');
  const xtags = parseYoutubeXtags(separator >= 0 ? record.id.slice(separator + 1) : '');
  const content = xtags.get('acont');
  return {
    id: key,
    languageTag: normalizeLanguageTag(xtags.get('lang')) ?? normalizeLanguageTag(record.languageId.split('.')[0]) ?? '',
    label: record.label.trim(),
    // `acont` is the host's own classification; an auto-dubbed flag without it is still a dub.
    kind: (content && CONTENT_KINDS[content]) || (record.autoDubbed ? 'dub' : 'unknown'),
    selected: record.selected
  };
}

function validRecord(value: unknown): value is YouTubeAudioRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return boundedString(record.id, 600) && record.id.length > 0 && boundedString(record.label, 200)
    && boundedString(record.languageId, 40) && typeof record.autoDubbed === 'boolean' && typeof record.selected === 'boolean';
}

/** Parses MAIN's answer, accepting it only for this request and this page. */
export function parseYouTubeAudio(text: string | null | undefined, requestId: string, pageHref: string): YouTubeAudioSnapshot | null {
  if (!text || text.length > MAX_SNAPSHOT_CHARS) return null;
  try {
    const data = JSON.parse(text) as Partial<YouTubeAudioSnapshot>;
    if (!data || data.requestId !== requestId || data.pageHref !== pageHref || !isVideoId(data.videoId) || typeof data.ad !== 'boolean') return null;
    if (!Array.isArray(data.tracks) || data.tracks.length > MAX_TRACKS || !data.tracks.every(validRecord)) return null;
    return data as YouTubeAudioSnapshot;
  } catch {
    return null;
  }
}

export function encodeYouTubeAudioSelect(request: YouTubeAudioSelect): string {
  return JSON.stringify(request);
}

/** MAIN's check of a selection request; anything else is dropped unanswered. */
export function parseYouTubeAudioSelect(raw: unknown): YouTubeAudioSelect | null {
  if (typeof raw !== 'string' || raw.length > 1000) return null;
  try {
    const data = JSON.parse(raw) as Partial<YouTubeAudioSelect>;
    if (!data || !isRequestId(data.requestId) || !isVideoId(data.videoId) || !boundedString(data.trackId, 600) || !data.trackId) return null;
    return { requestId: data.requestId, videoId: data.videoId, trackId: data.trackId };
  } catch {
    return null;
  }
}

let requestCounter = 0;
const nextRequestId = () => `${Date.now()}:${++requestCounter}`;

/** Synchronous read of the player's tracks; null when MAIN does not answer for this page. */
export function queryYouTubeAudioTracks(doc: Document): YouTubeAudioSnapshot | null {
  const view = doc.defaultView;
  if (!view) return null;
  const requestId = nextRequestId();
  const pageHref = view.location.href;
  view.dispatchEvent(new CustomEvent(YOUTUBE_AUDIO_QUERY, { detail: requestId }));
  return parseYouTubeAudio(doc.getElementById(YOUTUBE_AUDIO_SNAPSHOT)?.textContent, requestId, pageHref);
}

/** Asks MAIN to select `trackId` if the player still plays `videoId` outside an ad and still offers it. */
export function requestYouTubeAudioTrack(doc: Document, videoId: string, trackId: string): boolean {
  const view = doc.defaultView;
  if (!view) return false;
  const requestId = nextRequestId();
  view.dispatchEvent(new CustomEvent(YOUTUBE_AUDIO_SELECT, { detail: encodeYouTubeAudioSelect({ requestId, videoId, trackId }) }));
  return doc.getElementById(YOUTUBE_AUDIO_RESULT)?.textContent === JSON.stringify({ requestId, ok: true });
}
