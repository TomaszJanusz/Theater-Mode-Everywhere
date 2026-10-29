import { normalizeLanguageTag } from '../../media-features/audio-preference';
import { sanitizeContentTitle } from '../../media-features/content-title';
import type { AudioTrack } from '../../media-features/types';

/**
 * Viki's watch page carries one JSON document for the playing episode: the server-rendered
 * `__NEXT_DATA__`, and `/_next/data/<build>/videos/<id>.json` on client-side navigation, which the
 * page requests itself. Everything below reads that document; no other endpoint is called.
 */

const VIDEO_ID = /^\d{1,12}v$/;
const MAX_SECONDS = 12 * 60 * 60;
const MAX_TRACKS = 64;
const MAX_MARKERS = 8;

export type VikiSkipMarker = { label: string; start: number; end: number };
export type VikiCaptionTrack = { id: string; language: string; label: string; url: string };
export type VikiPlayback = {
  videoId: string;
  duration: number | null;
  skipMarkers: VikiSkipMarker[];
  /** Where the credits begin; the host offers the next episode from here. */
  creditsStart: number | null;
  captionTracks: VikiCaptionTrack[];
  previewUrl: string | null;
  /** Languages the episode offers audio in, and the one it was recorded in. */
  audioLanguages: string[];
  originalLanguage: string | null;
};

/** `/videos/<id>` with an optional slug; trailers and clips share the route. */
export function vikiVideoId(url: URL): string | null {
  if (url.protocol !== 'https:' || url.port || (url.hostname !== 'www.viki.com' && url.hostname !== 'viki.com')) return null;
  const id = /^\/videos\/(\d+v)(?:-[^/]*)?\/?$/.exec(url.pathname)?.[1];
  return id && VIDEO_ID.test(id) ? id : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function seconds(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_SECONDS ? value : null;
}

/** Labels arrive as HTML such as "Čeština <span dir='ltr'>(100%)</span>"; only the text is kept. */
function cleanLabel(value: unknown): string {
  if (typeof value !== 'string') return '';
  let text = '';
  let inTag = false;
  for (const char of value.slice(0, 200)) {
    if (char === '<') inTag = true;
    else if (char === '>' && inTag) { inTag = false; text += ' '; } else if (!inTag) text += char;
  }
  return sanitizeContentTitle(text) ?? '';
}

function parseLanguages(list: unknown): string[] {
  const tags = (Array.isArray(list) ? list.slice(0, MAX_TRACKS) : []).flatMap(item => normalizeLanguageTag(item) ?? []);
  return [...new Set(tags)];
}

function parseMarkers(queue: unknown): VikiSkipMarker[] {
  const markers: VikiSkipMarker[] = [];
  for (const item of Array.isArray(queue) ? queue.slice(0, MAX_MARKERS) : []) {
    for (const row of Array.isArray(record(item)?.skipMarkers) ? (record(item)!.skipMarkers as unknown[]).slice(0, MAX_MARKERS) : []) {
      const marker = record(row);
      const start = seconds(marker?.startTime);
      const end = seconds(marker?.endTime);
      const label = typeof marker?.label === 'string' ? marker.label : '';
      if (start === null || end === null || end <= start || !/^[a-z_]{1,32}$/.test(label)) continue;
      markers.push({ label, start, end });
    }
  }
  return markers.sort((a, b) => a.start - b.start);
}

function parseTracks(videoId: string, list: unknown): VikiCaptionTrack[] {
  const tracks: VikiCaptionTrack[] = [];
  const seen = new Set<string>();
  for (const row of Array.isArray(list) ? list.slice(0, MAX_TRACKS) : []) {
    const item = record(row);
    const language = typeof item?.srclang === 'string' ? item.srclang : '';
    const url = typeof item?.src === 'string' ? item.src : '';
    if (!/^[A-Za-z][A-Za-z0-9-]{1,11}$/.test(language) || seen.has(language) || !isVikiCaptionUrl(url, videoId)) continue;
    seen.add(language);
    tracks.push({ id: `viki:${language}`, language, label: cleanLabel(item?.label) || language, url });
  }
  return tracks;
}

/**
 * Reads `pageProps` of a watch page. Rejects a document for another episode, so a response that
 * arrives after navigation cannot describe the wrong video.
 */
export function parseVikiPlayback(pageProps: unknown, expectedId: string): VikiPlayback | null {
  if (!VIDEO_ID.test(expectedId)) return null;
  const stream = record(record(pageProps)?.videoPlaybackStreamJson);
  const video = record(stream?.video);
  if (!stream || !video || video.id !== expectedId) return null;
  const previewUrl = typeof stream.previewUrl === 'string' && isVikiPreviewUrl(stream.previewUrl, expectedId) ? stream.previewUrl : null;
  const queue = Array.isArray(stream.queue) ? stream.queue : [];
  const closing = queue.map(item => seconds(record(item)?.closingMarker)).find((value): value is number => value !== null);
  return {
    videoId: expectedId,
    duration: seconds(video.duration),
    skipMarkers: parseMarkers(queue),
    creditsStart: closing ?? seconds(video.credits_marker),
    captionTracks: parseTracks(expectedId, record(stream.streamSubtitles)?.dash ?? stream.subtitles),
    previewUrl,
    audioLanguages: parseLanguages(video.audio_languages),
    originalLanguage: normalizeLanguageTag(record(video.origin)?.language)
  };
}

function httpsUrl(url: string): URL | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.port ? parsed : null;
  } catch {
    return null;
  }
}

/** The page's own subtitle file: `https://api.viki.io/v4/videos/<id>/subtitles/<lang>.vtt`, which the page lists and also loads as `auth_subtitles`. */
export function isVikiCaptionUrl(url: string, videoId?: string): boolean {
  const parsed = httpsUrl(url);
  const match = parsed && parsed.hostname === 'api.viki.io'
    ? /^\/v4\/videos\/(\d+v)\/(?:auth_)?subtitles\/[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?\.vtt$/.exec(parsed.pathname) : null;
  return Boolean(match) && (videoId === undefined || match![1] === videoId);
}

/** The page's own timeline preview list: `https://manifest-viki.viki.io/v1/streams/<id>/preview.vtt`. */
export function isVikiPreviewUrl(url: string, videoId?: string): boolean {
  const parsed = httpsUrl(url);
  const match = parsed && parsed.hostname === 'manifest-viki.viki.io'
    ? /^\/v1\/streams\/(\d+v)\/preview\.vtt$/.exec(parsed.pathname) : null;
  return Boolean(match) && (videoId === undefined || match![1] === videoId);
}

/** Sprite sheets named by the preview list. */
export function isVikiPreviewImageUrl(url: string): boolean {
  const parsed = httpsUrl(url);
  return Boolean(parsed && /^vikiplatform(?:-\d+)?\.akamaized\.net$/.test(parsed.hostname) && /\.jpe?g$/i.test(parsed.pathname));
}

/**
 * The `_next/data` request the page makes for this episode when it navigates to it: taken from its
 * resource timeline, which Viki clears from time to time, else rebuilt from the build id the page
 * itself carries, in the same form.
 */
export function vikiNextDataUrl(resourceNames: readonly string[], videoId: string, origin: string, buildId?: unknown): string | null {
  if (!VIDEO_ID.test(videoId)) return null;
  const pattern = new RegExp(`^/_next/data/[\\w-]+/videos/${videoId}\\.json$`);
  for (let index = resourceNames.length - 1; index >= 0; index -= 1) {
    const parsed = httpsUrl(resourceNames[index]);
    if (parsed && parsed.origin === origin && pattern.test(parsed.pathname)) return parsed.href;
  }
  if (typeof buildId !== 'string' || !/^[\w-]{1,64}$/.test(buildId)) return null;
  const base = httpsUrl(origin);
  return base ? `${base.origin}/_next/data/${buildId}/videos/${videoId}.json?vid=${videoId}` : null;
}

/** The episode whose manifest the page requested last, which is the one the player is loading. */
export function vikiLoadedVideoId(resourceNames: readonly string[]): string | null {
  for (let index = resourceNames.length - 1; index >= 0; index -= 1) {
    const parsed = httpsUrl(resourceNames[index]);
    const id = parsed?.hostname === 'manifest-viki.viki.io' ? /^\/v1\/(\d+v)\/.*\/manifest\.mpd$/.exec(parsed.pathname)?.[1] : undefined;
    if (id) return id;
  }
  return null;
}

/** Chapters the host itself marks on the episode. */
export function vikiChapters(playback: VikiPlayback): Array<{ start: number; end?: number; title: string }> {
  const chapters = playback.skipMarkers.filter(marker => marker.label === 'skip_intro')
    .map(marker => ({ start: marker.start, end: marker.end, title: 'Intro' }));
  if (playback.creditsStart !== null && playback.duration !== null && playback.creditsStart < playback.duration) {
    chapters.push({ start: playback.creditsStart, end: playback.duration, title: 'Credits' });
  }
  return chapters;
}

/** One row of the player's audio menu. */
export type VikiAudioItem = { label: string; selected: boolean };

function plain(text: string): string {
  return text.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
}

/** "Original - 한국어" names the language after the marker; other rows are the language itself. */
function languagePart(label: string): string {
  return label.slice(label.lastIndexOf(' - ') + 1).replace(/^-\s*/, '');
}

function languageName(tag: string): string | null {
  try {
    return plain(new Intl.DisplayNames([tag], { type: 'language', fallback: 'none' }).of(tag.split('-')[0]) ?? '') || null;
  } catch {
    return null;
  }
}

/**
 * The menu's rows, in the menu's own order. Rows carry only a label in the viewer's interface
 * language, so the tag comes from the episode's `audio_languages`: the one language whose own
 * name starts the label. Two tags of one language (`ko`, `ko-KR`) are ambiguous and stay untagged,
 * as does a label that matches none. The original is the track in the language the episode was
 * recorded in, never inferred from the localized "Original" marker.
 */
export function vikiAudioTracks(items: readonly VikiAudioItem[], audioLanguages: readonly string[], originalLanguage: string | null): AudioTrack[] {
  const seen = new Map<string, number>();
  return items.map(item => {
    const label = item.label.replace(/\s+/g, ' ').trim().slice(0, 200);
    const name = plain(languagePart(label));
    const matches = audioLanguages.filter(tag => {
      const own = languageName(tag);
      return own !== null && (name === own || name.startsWith(`${own} `) || name.startsWith(`${own}(`));
    });
    const languages = new Set(matches.map(tag => tag.split('-')[0].toLowerCase()));
    const languageTag = matches.length === 1 ? matches[0] : '';
    const original = languageTag !== '' && originalLanguage !== null && languages.size === 1
      && languageTag.split('-')[0].toLowerCase() === originalLanguage.split('-')[0].toLowerCase();
    let kind: AudioTrack['kind'] = 'unknown';
    if (original) kind = 'original';
    else if (languageTag !== '') kind = 'dub';
    // Viki lists the viewer's current choice first, so a row is named by its label, not its position.
    const key = plain(label).slice(0, 80);
    const repeat = seen.get(key) ?? 0;
    seen.set(key, repeat + 1);
    return { id: repeat ? `${key}#${repeat}` : key, languageTag, label, kind, selected: item.selected };
  });
}
