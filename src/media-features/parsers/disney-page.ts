import type { CaptionCue } from '../types';

export const DISNEY_SNAPSHOT_SCRIPT_ID = 'theater-everywhere-disney-snapshot';
export const DISNEY_CLOCK_EVENT = 'theater-everywhere-disney-clock';
export const DISNEY_PLAYHEAD_DATASET = 'teDisneyPlayhead';

export function readDisneyContentTime(video: HTMLVideoElement | null | undefined): number | null {
  if (!video) return null;
  try {
    const value = Number(video.dataset?.[DISNEY_PLAYHEAD_DATASET]);
    if (Number.isFinite(value) && value >= 0) return value;
  } catch {
    // Test doubles may omit dataset.
  }
  return null;
}

export const DISNEY_MEDIA_SEEK_STUCK_SECONDS = 15;

// MAIN (`src/mainWorld.ts`) duplicates isUsableDisneyMediaVideo / ranking
// instead of importing this module — bundled content.js / mainWorld.js must
// stay free of ESM imports.

export function disneyMediaSeekLooksStuck(
  seekableEnd: number | null | undefined,
  targetSeconds: number
): boolean {
  if (seekableEnd == null || !Number.isFinite(seekableEnd) || !Number.isFinite(targetSeconds)) return false;
  return targetSeconds > seekableEnd + DISNEY_MEDIA_SEEK_STUCK_SECONDS;
}

export function isUsableDisneyMediaVideo(video: HTMLVideoElement | null | undefined): boolean {
  if (!video) return false;
  const className = typeof video.className === 'string' ? video.className : '';
  if (/\bbtm-media-client-element\b/.test(className)) return false;
  let display = '';
  try {
    display = video.style?.display || '';
  } catch {
    // Test doubles may omit style.
  }
  try {
    if (typeof getComputedStyle === 'function' && typeof (video as Node).nodeType === 'number') {
      display = getComputedStyle(video).display || display;
    }
  } catch {
    // jsdom/test doubles may not compute styles.
  }
  if (display === 'none') return false;
  const videoWidth = Number(video.videoWidth) || 0;
  let boxW = Number(video.clientWidth) || 0;
  let boxH = Number(video.clientHeight) || 0;
  try {
    if (typeof video.getBoundingClientRect === 'function') {
      const rect = video.getBoundingClientRect();
      boxW = Math.max(boxW, rect.width || 0);
      boxH = Math.max(boxH, rect.height || 0);
    }
  } catch {
    // Ignore layout-less test doubles.
  }
  const hasBox = boxW > 8 && boxH > 8;
  const hasSource = Boolean(video.currentSrc || video.src);
  if (/\bhive-video\b/.test(className) || /\btheater-everywhere-video-active\b/.test(className)) {
    return videoWidth > 0 || hasSource || hasBox;
  }
  return (videoWidth > 0 || hasSource) && hasBox;
}

export function rankDisneyMediaVideos(videos: HTMLVideoElement[]): HTMLVideoElement[] {
  const usable = videos.filter((item) => isUsableDisneyMediaVideo(item));
  const score = (item: HTMLVideoElement) => {
    const className = typeof item.className === 'string' ? item.className : '';
    if (/\btheater-everywhere-video-active\b/.test(className)) return 3;
    if (/\bhive-video\b/.test(className)) return 2;
    return 1;
  };
  return usable.slice().sort((a, b) => score(b) - score(a));
}

export type DisneyPageCaption = {
  id: string;
  url: string;
  language: string;
  label: string;
};

export type DisneyThumbnailMeta = {
  width: number;
  height: number;
  intervalMs: number;
  bifUrl?: string;
};

export type DisneyBifFrame = {
  time: number;
  start: number;
  end: number;
};

export type DisneyBifSet = {
  width: number;
  height: number;
  frames: DisneyBifFrame[];
  buffer: ArrayBuffer;
};

export type DisneyPlaybackAssets = {
  mediaId?: string;
  duration?: number;
  masterUrl?: string;
  captions: DisneyPageCaption[];
  storyboardUrl?: string;
  bifBlobUrl?: string;
  thumbnail?: DisneyThumbnailMeta;
};

const MIN_VOD_SECONDS = 30;
const MAX_VOD_SECONDS = 12 * 60 * 60;
const CLOCK_RE = /(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:[.,]\d{1,3})?/g;
const DURATION_KEY_RE = /^(runtime(millis|ms)?|duration(millis|ms|inms)?|length(millis|ms)?)$/i;
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const BIF_MAGIC = [0x89, 0x42, 0x49, 0x46, 0x0d, 0x0a, 0x1a, 0x0a];

function stripWww(hostname: string): string {
  return hostname.replace(/^www\./i, '').toLowerCase();
}

export { isDisneyHost } from '../../providers/hosts';

export function disneyPlayId(href: string): string | null {
  try {
    const url = new URL(href, 'https://www.disneyplus.com');
    const play = url.pathname.match(/\/play\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    if (play) return play[1].toLowerCase();
    const video = url.pathname.match(/\/video\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    return video ? video[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

export function parseDisneyClock(value: string): number | null {
  const match = value.trim().match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/);
  if (!match) return null;
  const hours = match[1] ? Number(match[1]) : 0;
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const fraction = match[4] ? Number(match[4].padEnd(3, '0')) : 0;
  if (![hours, minutes, seconds, fraction].every(Number.isFinite)) return null;
  if (minutes > 59 || seconds > 59) return null;
  const total = hours * 3600 + minutes * 60 + seconds + fraction / 1000;
  return total >= 0 ? total : null;
}

export function disneyDurationSeconds(value: number): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  if (value > MAX_VOD_SECONDS && value <= MAX_VOD_SECONDS * 1000) {
    const seconds = value / 1000;
    return seconds >= MIN_VOD_SECONDS ? seconds : null;
  }
  if (value >= MIN_VOD_SECONDS && value <= MAX_VOD_SECONDS) return value;
  return null;
}

export function isDisneyMediaHost(hostname: string): boolean {
  const host = stripWww(hostname);
  if (host === 'dssott.com' || host.endsWith('.dssott.com')) return true;
  if (host.endsWith('.disney-plus.net') || host === 'disney-plus.net') return true;
  if (host.endsWith('.bamgrid.com') || host === 'bamgrid.com') return true;
  return false;
}

function isDisneyApiHost(hostname: string): boolean {
  const host = stripWww(hostname);
  return host === 'disney.api.edge.bamgrid.com'
    || host.endsWith('.api.edge.bamgrid.com')
    || host === 'disney.playback.edge.bamgrid.com'
    || host.endsWith('.playback.edge.bamgrid.com');
}

function parsedHttpsUrl(url: string): URL | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return null;
    return parsed;
  } catch {
    return null;
  }
}

function isDssott(url: URL): boolean {
  const host = stripWww(url.hostname);
  return host === 'dssott.com' || host.endsWith('.dssott.com');
}

export function isSafeDisneyMasterUrl(url: string): boolean {
  const parsed = parsedHttpsUrl(url);
  if (!parsed || !isDssott(parsed)) return false;
  return /\.m3u8$/i.test(parsed.pathname) && /una-ctr-all/i.test(url);
}

export function isSafeDisneyCaptionUrl(url: string): boolean {
  const parsed = parsedHttpsUrl(url);
  if (!parsed || !isDssott(parsed)) return false;
  if (/\.vtt$/i.test(parsed.pathname) || /SUBTITLE_1_WEBVTT/i.test(url)) return true;
  return /\.m3u8$/i.test(parsed.pathname) && /composite_[^/?#]+_(NORMAL|FORCED|SDH)_/i.test(url);
}

export const MIN_DISNEY_TIMELINE_BIF_FRAMES = 8;

export function isSafeDisneyBifUrl(url: string): boolean {
  const parsed = parsedHttpsUrl(url);
  if (!parsed || !isDssott(parsed)) return false;
  if (/DUB_CARD/i.test(url)) return false;
  return /\.bif$/i.test(parsed.pathname) && /thumbnails?\//i.test(url);
}

export function disneyBifFrameCount(buffer: ArrayBuffer): number {
  if (buffer.byteLength < 80) return 0;
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < BIF_MAGIC.length; i++) {
    if (bytes[i] !== BIF_MAGIC[i]) return 0;
  }
  const count = new DataView(buffer).getUint32(12, true);
  return Number.isFinite(count) && count > 0 && count <= 4000 ? count : 0;
}

export function isDisneyTimelineBif(buffer: ArrayBuffer): boolean {
  return disneyBifFrameCount(buffer) >= MIN_DISNEY_TIMELINE_BIF_FRAMES;
}

export function isSafeDisneyStoryboardUrl(url: string): boolean {
  if (isSafeDisneyBifUrl(url)) return true;
  const parsed = parsedHttpsUrl(url);
  if (!parsed || !isDisneyMediaHost(parsed.hostname) || isDisneyApiHost(parsed.hostname)) return false;
  if (/\/(graph|graphql|explore|session)\b/i.test(parsed.pathname)) return false;
  const path = parsed.pathname;
  if (/\.(m3u8|mp4|m4s|mpd)$/i.test(path)) return false;
  if (/\.vtt$/i.test(path)) return /trick|thumb|sprite|storyboard|preview|bif/i.test(url);
  return /\.json$/i.test(path) && /trick|thumb|sprite|storyboard|preview/i.test(url);
}

export function isSafeDisneyImageUrl(url: string): boolean {
  if (url.startsWith('blob:')) return true;
  const parsed = parsedHttpsUrl(url);
  if (!parsed || !isDisneyMediaHost(parsed.hostname) || isDisneyApiHost(parsed.hostname)) return false;
  return /\.(jpe?g|png|webp|avif)$/i.test(parsed.pathname);
}

function stringUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^https:\/\//i.test(trimmed) ? trimmed : null;
}

function hlsAttr(line: string, name: string): string | null {
  const match = line.match(new RegExp(`${name}=(?:"([^"]*)"|([^,]*))`, 'i'));
  if (!match) return null;
  return (match[1] ?? match[2] ?? '').trim();
}

export function parseDisneyHlsSubtitles(body: string, baseUrl: string): DisneyPageCaption[] {
  const tracks: DisneyPageCaption[] = [];
  const seen = new Set<string>();
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('#EXT-X-MEDIA:') || !/TYPE=SUBTITLES/i.test(line)) continue;
    if (/FORCED=YES/i.test(line)) continue;
    const name = hlsAttr(line, 'NAME') || '';
    if (/--forced--/i.test(name)) continue;
    const language = (hlsAttr(line, 'LANGUAGE') || '').slice(0, 16);
    const uri = hlsAttr(line, 'URI');
    if (!uri) continue;
    let url: string;
    try {
      url = new URL(uri, baseUrl).toString();
    } catch {
      continue;
    }
    if (!isSafeDisneyCaptionUrl(url) || seen.has(url)) continue;
    seen.add(url);
    tracks.push({
      id: `disney:${language || tracks.length}:${url.slice(-48)}`.slice(0, 160),
      url,
      language,
      label: (name || language || 'Captions').slice(0, 80)
    });
    if (tracks.length >= 40) break;
  }
  return tracks;
}

export type DisneyVttSegment = {
  url: string;
  start: number;
  duration: number;
};

function ptsSecondsFromUrl(url: string): number | null {
  const match = url.match(/pts_(\d+)/i);
  if (!match) return null;
  const raw = Number(match[1]);
  if (!Number.isFinite(raw) || raw < 0) return null;
  return raw >= 1000 ? raw / 1000 : raw;
}

export function parseDisneyHlsVttPlaylist(body: string, baseUrl: string): DisneyVttSegment[] {
  const segments: DisneyVttSegment[] = [];
  let time = 0;
  let pendingDuration = 0;
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (/^#EXTINF:/i.test(line)) {
      const duration = Number.parseFloat(line.slice(8));
      pendingDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
      continue;
    }
    if (!line || line.startsWith('#')) continue;
    try {
      const url = new URL(line, baseUrl).toString();
      if (!isSafeDisneyCaptionUrl(url) || /\.m3u8$/i.test(new URL(url).pathname)) continue;
      const pts = ptsSecondsFromUrl(url);
      const start = pts != null ? pts : time;
      const duration = pendingDuration;
      segments.push({ url, start, duration });
      time = start + (duration || 0);
      pendingDuration = 0;
    } catch {
      pendingDuration = 0;
    }
    if (segments.length >= 250) break;
  }
  return segments;
}

export function parseDisneyHlsVttSegments(body: string, baseUrl: string): string[] {
  return parseDisneyHlsVttPlaylist(body, baseUrl).map((segment) => segment.url);
}

export function alignDisneyVttCues(
  cues: CaptionCue[],
  segmentStart: number,
  segmentDuration = 0
): CaptionCue[] {
  if (cues.length === 0 || !Number.isFinite(segmentStart) || segmentStart <= 0) return cues;
  const first = cues.reduce((min, cue) => Math.min(min, cue.start), cues[0].start);
  const last = cues.reduce((max, cue) => Math.max(max, cue.end), cues[0].end);
  const window = segmentDuration > 1 ? segmentDuration : 0;
  const inAbsoluteWindow = first + 0.25 >= segmentStart && (window <= 0 || first < segmentStart + window + 15);
  if (inAbsoluteWindow) return cues;
  const looksRelative = first < 2 && (window <= 0 || last <= window + 2);
  if (!looksRelative) return cues;
  return cues.map((cue) => ({
    ...cue,
    start: cue.start + segmentStart,
    end: cue.end + segmentStart,
    ...(cue.words
      ? {
          words: cue.words.map((word) => ({
            ...word,
            start: word.start + segmentStart,
            end: word.end + segmentStart
          }))
        }
      : {})
  }));
}

export function parseDisneyThumbnailIndex(raw: unknown): DisneyThumbnailMeta | null {
  if (!raw || typeof raw !== 'object') return null;
  const bifs = (raw as { bifs?: unknown }).bifs;
  if (!Array.isArray(bifs)) return null;
  let best: DisneyThumbnailMeta | null = null;
  for (const entry of bifs) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    const presentations = Array.isArray(item.presentations) ? item.presentations : [];
    const main = presentations.find((presentation) => {
      if (!presentation || typeof presentation !== 'object') return false;
      return String((presentation as { presentationType?: string }).presentationType || '').toUpperCase() === 'MAIN';
    });
    if (!main || typeof main !== 'object') continue;
    const paths = (main as { paths?: unknown }).paths;
    const bifUrl = Array.isArray(paths) ? paths.find((path): path is string => typeof path === 'string' && isSafeDisneyBifUrl(path)) : undefined;
    if (!bifUrl) continue;
    const width = Number(item.thumbnailWidth);
    const height = Number(item.thumbnailHeight);
    const intervalMs = Number(item.intervalMilliseconds);
    const meta: DisneyThumbnailMeta = {
      width: Number.isFinite(width) && width > 0 ? width : 480,
      height: Number.isFinite(height) && height > 0 ? height : 270,
      intervalMs: Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 10_000,
      bifUrl
    };
    const count = Number((main as { thumbnailCount?: number }).thumbnailCount);
    if (!best || (Number.isFinite(count) && count > 10)) best = meta;
  }
  return best;
}

export function disneyBifTimestampSeconds(timestamp: number, multiplier: number, intervalMs = 10_000): number | null {
  if (!Number.isFinite(timestamp) || timestamp === 0xffffffff) return null;
  const unit = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1000;
  if (unit <= 1 && timestamp >= 1000) return timestamp / 1000;
  if (unit >= 1000 && timestamp >= unit) return timestamp / 1000;
  const seconds = timestamp * unit / 1000;
  return seconds >= 0 ? seconds : (intervalMs > 0 ? timestamp * (intervalMs / 1000) : null);
}

export function parseRokuBif(buffer: ArrayBuffer, meta?: Partial<DisneyThumbnailMeta>): DisneyBifSet | null {
  const bytes = new Uint8Array(buffer);
  if (bytes.byteLength < 80) return null;
  for (let i = 0; i < BIF_MAGIC.length; i++) {
    if (bytes[i] !== BIF_MAGIC[i]) return null;
  }
  const view = new DataView(buffer);
  const count = view.getUint32(12, true);
  const multiplier = view.getUint32(16, true) || 1000;
  if (count < 1 || count > 4000) return null;
  const frames: DisneyBifFrame[] = [];
  for (let i = 0; i < count; i++) {
    const at = 64 + i * 8;
    const nextAt = at + 8;
    if (nextAt + 8 > bytes.byteLength) break;
    const timestamp = view.getUint32(at, true);
    const start = view.getUint32(at + 4, true);
    const end = view.getUint32(nextAt + 4, true);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || start >= bytes.byteLength) continue;
    const mapped = disneyBifTimestampSeconds(timestamp, multiplier, meta?.intervalMs);
    const time = mapped == null
      ? i * ((meta?.intervalMs || 10_000) / 1000)
      : mapped;
    frames.push({ time, start, end: Math.min(end, bytes.byteLength) });
  }
  if (frames.length === 0) return null;
  return {
    width: meta?.width && meta.width > 0 ? meta.width : 480,
    height: meta?.height && meta.height > 0 ? meta.height : 270,
    frames,
    buffer
  };
}

export function parseDisneyPlaybackPayload(raw: unknown, mediaId?: string | null): DisneyPlaybackAssets {
  const namedDurations: number[] = [];
  const storyboards: string[] = [];
  let masterUrl: string | undefined;
  let thumbnail = parseDisneyThumbnailIndex(raw);
  let budget = 5000;

  const walk = (node: unknown, depth: number) => {
    if (budget <= 0 || node == null || depth > 14) return;
    budget -= 1;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    if (typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    if (!thumbnail) thumbnail = parseDisneyThumbnailIndex(record);

    for (const [key, value] of Object.entries(record)) {
      if (typeof value === 'number' && DURATION_KEY_RE.test(key)) {
        const seconds = disneyDurationSeconds(value);
        if (seconds != null) namedDurations.push(seconds);
      }
      const url = stringUrl(value);
      if (!url) continue;
      if (!masterUrl && (key === 'url' || key === 'complete') && isSafeDisneyMasterUrl(url)) masterUrl = url;
      if (isSafeDisneyBifUrl(url) && !storyboards.includes(url)) storyboards.push(url);
    }

    const complete = record.complete;
    if (complete && typeof complete === 'object') {
      const completeUrl = stringUrl((complete as { url?: unknown }).url);
      if (completeUrl && isSafeDisneyMasterUrl(completeUrl)) masterUrl = completeUrl;
    }

    for (const value of Object.values(record)) walk(value, depth + 1);
  };

  walk(raw, 0);

  return {
    mediaId: mediaId || undefined,
    duration: namedDurations.length > 0 ? Math.max(...namedDurations) : undefined,
    masterUrl,
    captions: [],
    storyboardUrl: thumbnail?.bifUrl || storyboards[0],
    thumbnail: thumbnail ?? undefined
  };
}

export function parseDisneyChromeDurationFromHtml(html: string): number | null {
  if (!html) return null;
  const found: number[] = [];
  for (const match of html.matchAll(/aria-valuemax\s*=\s*["']?(\d+(?:\.\d+)?)/gi)) {
    const seconds = disneyDurationSeconds(Number(match[1]));
    if (seconds != null) found.push(seconds);
  }
  CLOCK_RE.lastIndex = 0;
  let clock: RegExpExecArray | null;
  while ((clock = CLOCK_RE.exec(html))) {
    const seconds = parseDisneyClock(clock[0]);
    if (seconds != null && seconds >= MIN_VOD_SECONDS && seconds <= MAX_VOD_SECONDS) found.push(seconds);
  }
  return found.length > 0 ? Math.max(...found) : null;
}

export function readDisneyChromeDuration(root: ParentNode | null | undefined): number | null {
  if (!root || typeof (root as ParentNode).querySelector !== 'function') {
    return parseDisneyChromeDurationFromHtml(typeof root === 'object' && root && 'textContent' in root
      ? String((root as { textContent?: string }).textContent || '')
      : '');
  }
  const overlay = (root as ParentNode).querySelector('.DxcOverlay') || root;
  const found: number[] = [];
  const nodes = overlay.querySelectorAll('[aria-valuemax]');
  nodes.forEach((node) => {
    const seconds = disneyDurationSeconds(Number(node.getAttribute('aria-valuemax')));
    if (seconds != null) found.push(seconds);
  });
  const text = overlay instanceof HTMLElement
    ? overlay.innerText || overlay.textContent || ''
    : (overlay as ParentNode as { textContent?: string }).textContent || '';
  CLOCK_RE.lastIndex = 0;
  let clock: RegExpExecArray | null;
  while ((clock = CLOCK_RE.exec(text))) {
    const seconds = parseDisneyClock(clock[0]);
    if (seconds != null && seconds >= MIN_VOD_SECONDS && seconds <= MAX_VOD_SECONDS) found.push(seconds);
  }
  if (found.length === 0 && overlay !== root) {
    return parseDisneyChromeDurationFromHtml((root as { documentElement?: { innerHTML?: string } }).documentElement?.innerHTML
      || (root instanceof HTMLElement ? root.innerHTML : '')
      || text);
  }
  return found.length > 0 ? Math.max(...found) : null;
}

export function readPublishedDisneySnapshot(
  root: Pick<ParentNode, 'querySelector'> | null | undefined = typeof document === 'undefined' ? null : document
): DisneyPlaybackAssets | null {
  if (!root) return null;
  const el = root.querySelector(`#${DISNEY_SNAPSHOT_SCRIPT_ID}`);
  const text = el?.textContent || '';
  if (!text) return null;
  try {
    const data = JSON.parse(text) as DisneyPlaybackAssets;
    if (!data || typeof data !== 'object') return null;
    const duration = Number(data.duration);
    const masterUrl = typeof data.masterUrl === 'string' && isSafeDisneyMasterUrl(data.masterUrl) ? data.masterUrl : undefined;
    const storyboardUrl = typeof data.storyboardUrl === 'string' && isSafeDisneyBifUrl(data.storyboardUrl)
      ? data.storyboardUrl
      : undefined;
    const bifBlobUrl = typeof data.bifBlobUrl === 'string' && data.bifBlobUrl.startsWith('blob:') ? data.bifBlobUrl : undefined;
    const thumbnail = data.thumbnail && typeof data.thumbnail === 'object'
      ? {
          width: Number(data.thumbnail.width) || 480,
          height: Number(data.thumbnail.height) || 270,
          intervalMs: Number(data.thumbnail.intervalMs) || 10_000,
          bifUrl: typeof data.thumbnail.bifUrl === 'string' && isSafeDisneyBifUrl(data.thumbnail.bifUrl)
            ? data.thumbnail.bifUrl
            : storyboardUrl
        }
      : (storyboardUrl ? { width: 480, height: 270, intervalMs: 10_000, bifUrl: storyboardUrl } : undefined);
    const mediaId = typeof data.mediaId === 'string' && UUID_RE.test(data.mediaId) ? data.mediaId.toLowerCase() : undefined;
    if (!mediaId && !masterUrl && !storyboardUrl && !bifBlobUrl && !(Number.isFinite(duration) && duration > 0)) return null;
    return {
      mediaId,
      duration: Number.isFinite(duration) && duration > 0 ? duration : undefined,
      masterUrl,
      captions: [],
      storyboardUrl: thumbnail?.bifUrl || storyboardUrl,
      bifBlobUrl,
      thumbnail
    };
  } catch {
    return null;
  }
}
