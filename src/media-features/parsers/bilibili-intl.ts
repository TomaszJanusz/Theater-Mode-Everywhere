import { sanitizeContentTitle } from '../content-title';
import { sanitizeCaptionCueText } from '../sanitize';
import type { CaptionCue, PreviewFrame } from '../types';

export type BilibiliIntlKind = 'ogv' | 'ugc';

/** Player skip windows, in seconds. These are intro/outro ranges, not named chapter titles. */
export type BilibiliIntlChapter = {
  start: number;
  end: number;
  title: 'Intro' | 'Outro';
};

export type BilibiliIntlCaption = {
  id: string;
  language: string;
  label: string;
  url: string;
};

export type BilibiliIntlStoryboard = {
  images: string[];
  /** Big-endian uint16 seconds. The first value is a sentinel and the last is the end boundary. */
  times: number[];
  columns: number;
  rows: number;
  width: number;
  height: number;
};

export type BilibiliIntlSnapshot = {
  videoId: string;
  kind: BilibiliIntlKind;
  title?: string;
  duration?: number;
  captionTracks: BilibiliIntlCaption[];
  storyboard: BilibiliIntlStoryboard | null;
  chapters: BilibiliIntlChapter[];
};

const OGV_SUBTITLE_PATH = /^\/ogv\/subtitle\/[a-f0-9]{16,80}\.(?:ass|json)$/i;
/** Public upload captions, observed on `p.bstarstatic.com` without `auth_key`. */
const UGC_SUBTITLE_PATH = /^\/ugc\/subtitle\/\d{10,13}_[a-f0-9]{16,32}_subtitle-\d{10,16}\.(?:json|ass)$/i;
const SHOT_IMAGE_PATH = /^\/videoshot\/[a-z0-9]+(?:-\d+)?\.(?:jpe?g|png|webp)$/i;
const SHOT_BIN_PATH = /^\/videoshot\/[a-z0-9]+\.bin$/i;
const MAX_CUES = 20000;
const MAX_CAPTION_BYTES = 2 * 1024 * 1024;
const MAX_SHOT_BYTES = 64 * 1024;

/** Path as written, before `URL` resolves ".." or decodes "%2e%2e". */
function rawHttpsPath(value: string): string | null {
  const match = /^https:\/\/[^/?#\s]*([^?#]*)/i.exec(value.trim());
  if (!match?.[1]?.startsWith('/')) return null;
  return match[1];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function httpsUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    return url;
  } catch {
    return null;
  }
}

/**
 * Accepts a static URL only when the raw path already matches the allowlist.
 * Normalization must not turn `/ogv/subtitle/abcd/../<file>.ass` into a hit.
 */
function allowedStaticUrl(value: unknown, hostname: string, pathPattern: RegExp, query: 'none' | 'auth'): string | null {
  if (typeof value !== 'string' || !value || value.length > 2000) return null;
  const rawPath = rawHttpsPath(value);
  const url = httpsUrl(value);
  if (!rawPath || !url || url.hostname !== hostname || rawPath !== url.pathname || !pathPattern.test(rawPath)) return null;
  if (query === 'none') {
    if (url.search) return null;
  } else if (url.search && !/^\?auth_key=[\w.~-]{1,200}$/.test(url.search)) return null;
  return url.href;
}

/**
 * Episode files are signed objects on `s.bstarstatic.com/ogv/subtitle/`.
 * Upload files are on `p.bstarstatic.com/ugc/subtitle/` and may omit `auth_key`.
 * Any other query is rejected. The raw path must already match, before `URL` resolves `..`.
 */
export function bilibiliIntlSubtitleUrl(value: unknown): string | null {
  return allowedStaticUrl(value, 's.bstarstatic.com', OGV_SUBTITLE_PATH, 'auth')
    || allowedStaticUrl(value, 'p.bstarstatic.com', UGC_SUBTITLE_PATH, 'auth');
}

export function bilibiliIntlShotImageUrl(value: unknown): string | null {
  return allowedStaticUrl(value, 'pic.bstarstatic.com', SHOT_IMAGE_PATH, 'none');
}

export function bilibiliIntlShotBinUrl(value: unknown): string | null {
  return allowedStaticUrl(value, 'pic.bstarstatic.com', SHOT_BIN_PATH, 'none');
}

/** pv_data from /video/shot: one big-endian uint16 second per entry, nondecreasing. */
export function parseBilibiliIntlShotIndex(bytes: Uint8Array): number[] | null {
  if (bytes.byteLength < 4 || bytes.byteLength > MAX_SHOT_BYTES || bytes.byteLength % 2 !== 0) return null;
  const times: number[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += 2) {
    const value = (bytes[offset] << 8) | bytes[offset + 1];
    if (times.length > 0 && value < times[times.length - 1]) return null;
    times.push(value);
  }
  // Sentinel, at least one tile start, and the end boundary.
  return times.length >= 3 ? times : null;
}

/** Exposed storyboard times: finite, non-negative, and nondecreasing. */
function finiteMonotonicTimes(times: number[] | null): times is number[] {
  if (!times || times.length < 3 || times.length > MAX_CUES) return false;
  for (let index = 0; index < times.length; index++) {
    const value = times[index];
    if (!Number.isFinite(value) || value < 0) return false;
    if (index > 0 && value < times[index - 1]) return false;
  }
  return true;
}

export function parseBilibiliIntlStoryboard(raw: unknown, times: number[] | null): BilibiliIntlStoryboard | null {
  if (!finiteMonotonicTimes(times)) return null;
  const data = record(raw);
  const columns = Number(data.x_len);
  const rows = Number(data.y_len);
  const width = Number(data.x_size);
  const height = Number(data.y_size);
  if (![columns, rows, width, height].every((value) => Number.isInteger(value) && value > 0 && value <= 2048)) return null;
  if (columns * rows > 10000 || columns * width > 32768 || rows * height > 32768) return null;
  if (!Array.isArray(data.images)) return null;
  const images = data.images.slice(0, 50).map(bilibiliIntlShotImageUrl);
  if (!images.length || images.some((value) => !value)) return null;
  return { images: images as string[], times, columns, rows, width, height };
}

/**
 * Tile choice compared with the official player (`Da` / `Aa` / `Na` in
 * `biliintl-player-dfb25af7.js`).
 *
 * `times[0]` is a sentinel, so tile n starts at `times[n + 1]`. The last
 * value is the end boundary, not a tile: the last real interval is
 * `[times[length - 2], times[length - 1])` and its index is `length - 3`.
 * Official `Da` defaults to `length - 2` when time is outside every
 * half-open interval, including exactly at that end boundary. `Aa` will
 * still paint that cell when the sheet has room. That cell is not a tile,
 * so time at or past the end keeps the last real tile instead.
 * `Aa`/`Na` hardcode a 10×10 sheet; the live `/video/shot` response is
 * 10×10, and the reported `x_len`/`y_len` select the cell. A sheet index
 * with no image is not a frame.
 */
export function bilibiliIntlPreviewFrame(storyboard: BilibiliIntlStoryboard, time: number): PreviewFrame | null {
  if (!Number.isFinite(time) || !finiteMonotonicTimes(storyboard.times)) return null;
  const times = storyboard.times;
  const clock = Math.max(0, time);
  let index = -1;
  for (let cursor = 0; cursor < times.length - 1; cursor++) {
    if (clock >= times[cursor] && clock < times[cursor + 1]) {
      index = cursor - 1;
      break;
    }
  }
  if (index < 0 && clock >= times[times.length - 1]) index = times.length - 3;
  if (index < 0 || index > times.length - 3) return null;
  const perSheet = storyboard.columns * storyboard.rows;
  if (!Number.isInteger(perSheet) || perSheet <= 0) return null;
  const url = storyboard.images[Math.floor(index / perSheet)];
  if (!url) return null;
  const tile = index % perSheet;
  return {
    time: times[index + 1],
    width: storyboard.width,
    height: storyboard.height,
    image: {
      kind: 'sprite',
      url,
      x: (tile % storyboard.columns) * storyboard.width,
      y: Math.floor(tile / storyboard.columns) * storyboard.height,
      tileWidth: storyboard.width,
      tileHeight: storyboard.height,
      sheetWidth: storyboard.width * storyboard.columns,
      sheetHeight: storyboard.height * storyboard.rows
    }
  };
}

function assClock(value: string): number | null {
  const match = /^(\d+):(\d{2}):(\d{2}\.\d{1,3})$/.exec(value.trim());
  if (!match) return null;
  const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

/** Drops ASS override tags and drawing segments. `\p1` starts a drawing; `\pos` does not. */
function assPlainText(value: string): string {
  let drawing = false;
  let text = '';
  const parts = value.split(/\{([^{}]*)\}/);
  const keep = (segment: string) => {
    if (!drawing && segment) text += segment;
  };
  keep(parts[0] || '');
  for (let index = 1; index < parts.length; index += 2) {
    const modes = [...(parts[index] || '').matchAll(/\\p(\d+)/g)];
    if (modes.length) drawing = Number(modes[modes.length - 1][1]) > 0;
    keep(parts[index + 1] || '');
  }
  return text.replace(/\\N/g, '\n').replace(/\\n/g, '\n').replace(/\\h/g, ' ');
}

function cue(start: number, end: number, text: string): CaptionCue | null {
  const cleaned = sanitizeCaptionCueText(text).slice(0, 4000);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || !cleaned) return null;
  return { start, end, text: cleaned };
}

function parseAss(body: string): CaptionCue[] {
  let startIndex = 1;
  let endIndex = 2;
  let textIndex = 9;
  const cues: CaptionCue[] = [];
  for (const line of body.split(/\r?\n/)) {
    if (cues.length >= MAX_CUES) break;
    if (line.startsWith('Format:') && /\bStart\b/.test(line) && /\bText\b/.test(line)) {
      const names = line.slice('Format:'.length).split(',').map((name) => name.trim().toLowerCase());
      const start = names.indexOf('start');
      const end = names.indexOf('end');
      const text = names.indexOf('text');
      if (start >= 0 && end >= 0 && text === names.length - 1) {
        startIndex = start;
        endIndex = end;
        textIndex = text;
      }
      continue;
    }
    if (!line.startsWith('Dialogue:')) continue;
    const fields = line.slice('Dialogue:'.length).split(',');
    if (fields.length <= textIndex) continue;
    const start = assClock(fields[startIndex] || '');
    const end = assClock(fields[endIndex] || '');
    const next = start !== null && end !== null ? cue(start, end, assPlainText(fields.slice(textIndex).join(','))) : null;
    if (next) cues.push(next);
  }
  return cues.sort((left, right) => left.start - right.start);
}

function parseJsonCues(body: string): CaptionCue[] {
  try {
    const data = record(JSON.parse(body));
    if (!Array.isArray(data.body)) return [];
    return data.body.slice(0, MAX_CUES).flatMap((raw): CaptionCue[] => {
      const row = record(raw);
      const start = Number(row.from);
      const end = Number(row.to);
      const content = typeof row.content === 'string' ? row.content.replace(/\\N/g, '\n').replace(/\\n/g, '\n') : '';
      const next = cue(start, end, content);
      return next ? [next] : [];
    }).sort((left, right) => left.start - right.start);
  } catch {
    return [];
  }
}

export function parseBilibiliIntlCaptions(body: string): CaptionCue[] {
  if (body.length > MAX_CAPTION_BYTES) return [];
  const trimmed = body.trim();
  // JSON cues are one object with body[]. A leading "[" is an ASS section
  // such as [Script Info], so only "{" selects JSON. Cue text may contain "Dialogue:".
  if (trimmed.startsWith('{')) return parseJsonCues(trimmed);
  if (trimmed.includes('Dialogue:')) return parseAss(trimmed);
  return [];
}

export function bilibiliIntlEpisodeId(value: unknown): string | null {
  const text = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
  return typeof text === 'string' && /^\d{1,20}$/.test(text) ? text : null;
}

/**
 * Hydrated `window.__initialState` stores `ogv.epId`, `ogv.season`, and
 * `ogv.sectionsList` as Vue refs (`__v_isRef`, `_value`, and a `value` getter).
 * SSR state is plain. No Vue runtime: read the getter, then the stored slots.
 */
export function unwrapBilibiliIntlValue(value: unknown): unknown {
  const seen = new Set<object>();
  let current = value;
  while (current && typeof current === 'object') {
    if (seen.has(current)) return current;
    const box = current as { __v_isRef?: unknown; value?: unknown; _value?: unknown; _rawValue?: unknown };
    if (box.__v_isRef !== true) return current;
    seen.add(current);
    let inner: unknown;
    try {
      inner = box.value;
    } catch {
      inner = undefined;
    }
    if (inner === undefined) inner = box._value !== undefined ? box._value : box._rawValue;
    if (inner === undefined || inner === current) return current;
    current = inner;
  }
  return current;
}

const MAX_SKIP_MS = 24 * 60 * 60 * 1000;
const MAX_SKIP_SECONDS = 24 * 60 * 60;
/**
 * HTML duration can sit a fraction under `floor(ms / 1000)`. One second covers that
 * without keeping a window that runs well past the known video.
 */
const SKIP_DURATION_SLACK_SECONDS = 1;

function skipSeconds(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > MAX_SKIP_MS) return null;
  const seconds = Math.floor(value / 1000);
  return seconds <= MAX_SKIP_SECONDS ? seconds : null;
}

function knownDuration(duration: number | undefined): number | null {
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0 || duration > MAX_SKIP_SECONDS) return null;
  return duration;
}

/**
 * `/v2/ogv/play/episode` returns `data.skip` in milliseconds and no titles.
 * The player seeks with `floor(ms / 1000)`. Labels are the fixed words Intro and
 * Outro, the same kind of window names as Crunchyroll's Intro and Credits.
 * They are navigation markers, not a named chapter list from the host.
 * A missing, negative, empty, overlapping, misordered, or out-of-duration window is dropped.
 * Opening is considered before ending, so an ending that starts before the opening
 * finishes is not kept. An ending alone is kept when the opening is absent.
 */
export function parseBilibiliIntlSkipChapters(payload: unknown, duration?: number): BilibiliIntlChapter[] {
  const limit = knownDuration(duration);
  const skip = record(record(payload).skip);
  const windows: Array<[string, string, BilibiliIntlChapter['title']]> = [
    ['opening_start_time', 'opening_end_time', 'Intro'],
    ['ending_start_time', 'ending_end_time', 'Outro']
  ];
  const chapters: BilibiliIntlChapter[] = [];
  for (const [startKey, endKey, title] of windows) {
    const start = skipSeconds(skip[startKey]);
    const end = skipSeconds(skip[endKey]);
    if (start === null || end === null || end <= start) continue;
    if (limit !== null && (start >= limit || end > limit + SKIP_DURATION_SLACK_SECONDS)) continue;
    const previous = chapters[chapters.length - 1];
    if (previous && start < previous.end) continue;
    chapters.push({ start, end, title });
  }
  return chapters;
}

function documentTitleFallback(documentTitle: unknown): string | null {
  if (typeof documentTitle !== 'string') return null;
  const page = sanitizeContentTitle(documentTitle.replace(/\s*[|\-–—]\s*bilibili$/i, ''));
  return page && page.toLowerCase() !== 'bilibili' ? page : null;
}

function ogvTitle(root: Record<string, unknown>): string | null {
  const ogv = record(unwrapBilibiliIntlValue(root.ogv));
  const season = sanitizeContentTitle(record(unwrapBilibiliIntlValue(ogv.season)).title);
  const episodeId = bilibiliIntlEpisodeId(unwrapBilibiliIntlValue(ogv.epId));
  let episodeTitle: string | null = null;
  const sectionsValue = unwrapBilibiliIntlValue(ogv.sectionsList);
  const sections = Array.isArray(sectionsValue) ? sectionsValue : [];
  for (const section of sections) {
    const episodesValue = unwrapBilibiliIntlValue(record(section).episodes);
    if (!Array.isArray(episodesValue)) continue;
    for (const raw of episodesValue) {
      const episode = record(unwrapBilibiliIntlValue(raw));
      if (bilibiliIntlEpisodeId(unwrapBilibiliIntlValue(episode.episode_id)) !== episodeId) continue;
      episodeTitle = sanitizeContentTitle(unwrapBilibiliIntlValue(episode.title_display))
        || sanitizeContentTitle(unwrapBilibiliIntlValue(episode.short_title_display));
    }
  }
  const combined = sanitizeContentTitle([season, episodeTitle].filter(Boolean).join(' '));
  return combined && combined.toLowerCase() !== 'bilibili' ? combined : null;
}

function ugcTitle(root: Record<string, unknown>): string | null {
  const ugc = record(unwrapBilibiliIntlValue(root.ugc));
  const archive = record(unwrapBilibiliIntlValue(ugc.archive));
  const title = sanitizeContentTitle(unwrapBilibiliIntlValue(archive.title));
  return title && title.toLowerCase() !== 'bilibili' ? title : null;
}

export function bilibiliIntlTitle(state: unknown, documentTitle?: unknown, kind?: BilibiliIntlKind): string | null {
  const root = record(unwrapBilibiliIntlValue(state));
  if (kind === 'ugc') return ugcTitle(root) || documentTitleFallback(documentTitle);
  const episode = ogvTitle(root);
  if (episode) return episode;
  if (kind === 'ogv') return documentTitleFallback(documentTitle);
  return ugcTitle(root) || documentTitleFallback(documentTitle);
}

function captionFileName(url: string): string {
  try {
    return new URL(url).pathname.split('/').filter(Boolean).pop() || 'track';
  } catch {
    return 'track';
  }
}

function pushTrack(kind: BilibiliIntlKind, videoId: string, language: string, label: string, url: string, seen: Map<string, number>, tracks: BilibiliIntlCaption[]): void {
  const accepted = bilibiliIntlSubtitleUrl(url);
  if (!accepted || tracks.length >= 80) return;
  const lang = language.slice(0, 40);
  const base = `bilibiliIntl:${kind}:${videoId}:${lang || 'und'}:${captionFileName(accepted)}`;
  const count = seen.get(base) || 0;
  seen.set(base, count + 1);
  tracks.push({
    id: (count === 0 ? base : `${base}:${count}`).slice(0, 180),
    language: lang,
    label: sanitizeContentTitle(label) || lang || 'und',
    url: accepted
  });
}

/** Live `/v2/subtitle` uses data.subtitles[].url. The page bundle also maps video_subtitle[].ass/srt. */
export function bilibiliIntlCaptionTracks(videoId: string, payload: unknown, kind: BilibiliIntlKind = 'ogv'): BilibiliIntlCaption[] {
  const data = record(payload);
  const live = Array.isArray(data.subtitles) ? data.subtitles : [];
  const legacy = Array.isArray(data.video_subtitle) ? data.video_subtitle : [];
  const rows = live.length ? live : legacy;
  const seen = new Map<string, number>();
  const tracks: BilibiliIntlCaption[] = [];
  for (const raw of rows) {
    const row = record(raw);
    const language = typeof row.lang_key === 'string' ? row.lang_key : '';
    const label = typeof row.lang === 'string' ? row.lang : language;
    const direct = typeof row.url === 'string' ? row.url : '';
    const ass = typeof record(row.ass).url === 'string' ? record(row.ass).url as string : '';
    const srt = typeof record(row.srt).url === 'string' ? record(row.srt).url as string : '';
    pushTrack(kind, videoId, language, label, direct || ass || srt, seen, tracks);
  }
  return tracks;
}

export function mergeBilibiliIntlSnapshot(previous: BilibiliIntlSnapshot | null, next: BilibiliIntlSnapshot | null): BilibiliIntlSnapshot | null {
  if (!next?.videoId) return null;
  // Keep a subtitle list only when this response is positively the same media and omits tracks.
  const sameMedia = previous?.videoId === next.videoId && (previous.kind || 'ogv') === (next.kind || 'ogv');
  if (sameMedia && previous && previous.captionTracks.length > 0 && next.captionTracks.length === 0) {
    return { ...next, captionTracks: previous.captionTracks };
  }
  return next;
}

export function normalizeBilibiliIntlSnapshot(
  videoId: string,
  title: string | null,
  duration: number | undefined,
  subtitles: unknown,
  storyboard: BilibiliIntlStoryboard | null,
  chapters: BilibiliIntlChapter[] = [],
  kind: BilibiliIntlKind = 'ogv'
): BilibiliIntlSnapshot {
  return {
    videoId,
    kind,
    title: title || undefined,
    duration: duration && Number.isFinite(duration) && duration > 0 ? duration : undefined,
    captionTracks: bilibiliIntlCaptionTracks(videoId, subtitles, kind),
    storyboard,
    chapters
  };
}
