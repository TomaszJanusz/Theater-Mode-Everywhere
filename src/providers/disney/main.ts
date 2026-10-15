import { readPageResponseBytes } from '../../platform/page-body';
import { shouldHarvestDisneyUrl, isDisneyBifUrl as isAllowedDisneyBifUrl } from '../network-harvest';
import {
  findDisneyContentTitle,
  readDisneyPlayerHeader,
  resolveDisneyTitle,
  stripDisneySiteTitle,
  type DisneyPlayerHeader,
  type DisneyTitleSource
} from '../../media-features/content-title';
import { MAX_CAPTION_BYTES } from '../../platform/media-url-policy';
import { mediaProviderIntegrationEnabled } from '../../media-features/provider-flags';
import { findActiveVideo } from '../../platform/active-video';
import { publishHiddenJson } from '../../platform/hidden-json';
import {
  DISNEY_CLOCK_MOUNT_MS,
  createDisneyClockScheduler,
  disneyPlayheadChanged,
  disneySeekSettlement,
  shouldRefreshDisneyTitle,
  type DisneyClockSample,
  type DisneyClockScheduler,
  type DisneyClockTick
} from './clock-policy';
import { installDisneyPlayNext } from './play-next';
import { isDisneyHost } from '../hosts';

export const MAX_BIF_BYTES = 16 * 1024 * 1024;

export function disneyIntegrationEnabled(): boolean {
  return mediaProviderIntegrationEnabled('disney');
}

type DisneyHarvest = {
  mediaId?: string;
  title?: string;
  subtitle?: string;
  duration?: number;
  /** Hive reported the program length. Harvested runtimes no longer replace it. */
  durationFromPlayer?: boolean;
  masterUrl?: string;
  storyboardUrl?: string;
  bifBlobUrl?: string;
  bifFrameCount?: number;
  thumbnail?: { width: number; height: number; intervalMs: number; bifUrl?: string };
  captions: Array<{ id: string; language: string; label: string; url: string }>;
};

type DisneyHivePlayer = {
  seek: (ms: number) => unknown;
  play?: () => unknown;
  pause?: () => unknown;
  scrub?: (ms: number) => unknown;
  on?: (name: string, handler: () => void) => unknown;
  timeline?: { info?: { playheadPositionMs?: number; programDurationMs?: number } };
};

const DISNEY_SNAPSHOT_SCRIPT_ID = 'theater-everywhere-disney-snapshot';
const DISNEY_DURATION_KEY_RE = /^(runtime(millis|ms)?|duration(millis|ms|inms)?|length(millis|ms)?)$/i;
const DISNEY_PLAY_ID_RE = /\/play\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
const DISNEY_CLOCK_EVENT = 'theater-everywhere-disney-clock';
const DISNEY_MEDIA_SEEK_STUCK_SECONDS = 15;
const DISNEY_SEEK_RETRY_MS = 1500;

let disneyHarvest: DisneyHarvest = { captions: [] };
let disneyHarvestNotifyTimer = 0;
let disneyTitlePlayId: string | null = null;
let disneyTitleSource: DisneyTitleSource | null = null;
let disneyPlaybackTitle: string | null = null;
let disneyPlayerHeader: DisneyPlayerHeader | null = null;
let cachedDisneyPlayer: DisneyHivePlayer | null = null;
let cachedDisneyPlayerHost: Element | null = null;
// Rediscovery of a connected old host is not evidence of a new playback session.
const disneyPlayerPlayIds = new WeakMap<DisneyHivePlayer, string | null>();
const disneyVideoPlayers = new WeakMap<HTMLVideoElement, DisneyHivePlayer>();
const disneyResettingPlayers = new WeakSet<DisneyHivePlayer>();
const disneyClockBoundPlayers = new WeakSet<object>();
let clockPlayerGeneration = 0;
let disneyClockTargets: HTMLVideoElement[] = [];
let disneyClockVideo: HTMLVideoElement | null = null;
let unwatchDisneyClockVideo: (() => void) | null = null;
let disneyClockScheduler: DisneyClockScheduler | null = null;
let disneyClockInstalled = false;
let lastDispatchedDisneyPlayhead: number | null = null;
let lastDispatchedPlayId: string | null = null;
let disneyClockSeekPlayId: string | null = null;
let disneyMountPlayId: string | null = null;
let disneyMountStartedAt = 0;
let pauseDisneyAfterSeek = false;
let resumeDisneyPlaybackAfterSeek = false;
let pendingDisneySeekTarget: number | null = null;
let disneyResumeAttemptGeneration = 0;
let disneySeekGeneration = 0;

function disneyPageMediaId(href = window.location.href): string | null {
  try {
    const match = new URL(href, 'https://www.disneyplus.com').pathname.match(DISNEY_PLAY_ID_RE);
    return match ? match[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

function isDssottHostName(hostname: string): boolean {
  const host = hostname.replace(/^www\./i, '').toLowerCase();
  return host === 'dssott.com' || host.endsWith('.dssott.com');
}

function disneyDurationSeconds(value: number): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  if (value > 12 * 3600 && value <= 12 * 3600 * 1000) {
    const seconds = value / 1000;
    return seconds >= 30 ? seconds : null;
  }
  if (value >= 30 && value <= 12 * 3600) return value;
  return null;
}

function isAllowedDisneyMasterUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !isDssottHostName(parsed.hostname)) return false;
    return /\.m3u8$/i.test(parsed.pathname) && /una-ctr-all/i.test(url);
  } catch {
    return false;
  }
}

export { isDisneyBifUrl as isAllowedDisneyBifUrl } from '../network-harvest';

function disneyBifFrameCount(buffer: ArrayBuffer): number {
  if (buffer.byteLength < 80) return 0;
  const bytes = new Uint8Array(buffer);
  const magic = [0x89, 0x42, 0x49, 0x46, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < magic.length; i++) {
    if (bytes[i] !== magic[i]) return 0;
  }
  const count = new DataView(buffer).getUint32(12, true);
  return Number.isFinite(count) && count > 0 && count <= 4000 ? count : 0;
}

function extractDisneyThumbnail(raw: unknown): { width: number; height: number; intervalMs: number; bifUrl: string } | null {
  if (!raw || typeof raw !== 'object') return null;
  const bifs = (raw as { bifs?: unknown }).bifs;
  if (!Array.isArray(bifs)) return null;
  let best: { width: number; height: number; intervalMs: number; bifUrl: string } | null = null;
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
    const bifUrl = Array.isArray(paths)
      ? paths.find((path): path is string => typeof path === 'string' && isAllowedDisneyBifUrl(path))
      : undefined;
    if (!bifUrl) continue;
    const width = Number(item.thumbnailWidth);
    const height = Number(item.thumbnailHeight);
    const intervalMs = Number(item.intervalMilliseconds);
    const meta = {
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

const DISNEY_CHROME_TITLE_SELECTOR = '[data-testid*="title" i], [class*="title" i], h1, h2, h3';
const DISNEY_CHROME_REJECT_RE = /^(?:play|pause|odtwórz|wstrzymaj|napisy|subtitles|audio|ustawienia|settings|wstecz|back|wróć|wroc|fullscreen|pełny ekran|mute|wycisz|cc|hd|ad|sdh|\d{1,2}:\d{2}(?::\d{2})?)$/i;

function disneyChromeLabel(el: Element): string | null {
  const structural = [...el.children].some((child) => !/^(?:SPAN|ABBR|B|I|STRONG|EM)$/.test(child.tagName));
  if (structural) return null;
  const text = stripDisneySiteTitle(el.textContent);
  if (!text || DISNEY_CHROME_REJECT_RE.test(text)) return null;
  return text;
}

function considerDisneyChromeTitle(
  el: Element,
  best: { text: string; rank: number; top: number } | null
): { text: string; rank: number; top: number } | null {
  const hook = `${el.getAttribute('data-testid') || ''} ${typeof el.className === 'string' ? el.className : ''}`;
  if (/subtitle|caption|timed-text|toast|up-next|upnext/i.test(hook)) return best;
  const titled = /title/i.test(hook);
  const heading = /^H[1-3]$/.test(el.tagName);
  if (!titled && !heading) return best;
  const text = disneyChromeLabel(el);
  if (!text) return best;
  const rect = el.getBoundingClientRect();
  if (rect.width < 8 || rect.height < 8) return best;
  const rank = titled ? 2 : 1;
  const candidate = { text, rank, top: rect.top };
  if (!best || rank > best.rank || (rank === best.rank && candidate.top < best.top - 8)) return candidate;
  return best;
}

function visitDisneyChromeRoot(
  root: ParentNode,
  depth: number,
  best: { text: string; rank: number; top: number } | null
): { text: string; rank: number; top: number } | null {
  if (depth > 6) return best;
  let next = best;
  for (const el of root.querySelectorAll(DISNEY_CHROME_TITLE_SELECTOR)) {
    next = considerDisneyChromeTitle(el, next);
  }
  for (const el of root.querySelectorAll('*')) {
    if (el.shadowRoot) next = visitDisneyChromeRoot(el.shadowRoot, depth + 1, next);
  }
  return next;
}

/** Title Disney draws in the player header, not the browse page behind it. */
function readDisneyPlayerChromeTitle(): string | null {
  const hosts = document.querySelectorAll('disney-web-player, .DxcOverlay');
  let best: { text: string; rank: number; top: number } | null = null;
  for (const host of hosts) {
    if (host.shadowRoot) best = visitDisneyChromeRoot(host.shadowRoot, 0, best);
    best = visitDisneyChromeRoot(host, 0, best);
  }
  return best?.text || null;
}

function syncDisneyDisplayedTitle(): boolean {
  const playId = disneyPageMediaId();
  const previousPlayId = disneyTitlePlayId;
  if (playId !== previousPlayId) {
    disneyPlaybackTitle = null;
    disneyPlayerHeader = null;
  }
  const resolved = resolveDisneyTitle({
    playId,
    previousPlayId,
    title: disneyHarvest.title || null,
    source: disneyTitleSource,
    playerHeader: disneyPlayerHeader?.title,
    playerChrome: readDisneyPlayerChromeTitle(),
    playbackTitle: disneyPlaybackTitle,
    documentTitle: document.title,
    openGraphTitle: document.querySelector('meta[property="og:title"]')?.getAttribute('content')
  });
  disneyTitlePlayId = playId;
  return applyDisneyTitle(resolved);
}

/** The episode label belongs to the player header, so another title source never inherits it. */
function applyDisneyTitle(resolved: { title: string | null; source: DisneyTitleSource | null }): boolean {
  const title = resolved.title || undefined;
  const subtitle = title && resolved.source === 'player' ? disneyPlayerHeader?.subtitle || undefined : undefined;
  const changed = title !== disneyHarvest.title || subtitle !== disneyHarvest.subtitle;
  disneyHarvest.title = title;
  disneyHarvest.subtitle = subtitle;
  disneyTitleSource = resolved.source;
  return changed;
}

function extractDisneyHarvest(raw: unknown): {
  title?: string;
  header?: DisneyPlayerHeader;
  duration?: number;
  masterUrl?: string;
  captions: Array<{ id: string; language: string; label: string; url: string }>;
  storyboardUrl?: string;
  thumbnail?: { width: number; height: number; intervalMs: number; bifUrl?: string };
} | null {
  if (raw == null || typeof raw !== 'object') return null;
  const captions: Array<{ id: string; language: string; label: string; url: string }> = [];
  const namedDurations: number[] = [];
  const storyboards: string[] = [];
  let masterUrl: string | undefined;
  let thumbnail = extractDisneyThumbnail(raw);
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
    if (!thumbnail) thumbnail = extractDisneyThumbnail(record);
    const complete = record.complete;
    if (complete && typeof complete === 'object') {
      const completeUrl = (complete as { url?: unknown }).url;
      if (typeof completeUrl === 'string' && isAllowedDisneyMasterUrl(completeUrl)) masterUrl = completeUrl;
    }
    for (const [key, value] of Object.entries(record)) {
      if (typeof value === 'number' && DISNEY_DURATION_KEY_RE.test(key)) {
        const seconds = disneyDurationSeconds(value);
        if (seconds != null) namedDurations.push(seconds);
      }
      if (typeof value !== 'string' || !value.startsWith('https://')) continue;
      if (!masterUrl && (key === 'url' || isAllowedDisneyMasterUrl(value)) && isAllowedDisneyMasterUrl(value)) {
        masterUrl = value;
      }
      if (isAllowedDisneyBifUrl(value) && !storyboards.includes(value)) storyboards.push(value);
    }
    for (const value of Object.values(record)) walk(value, depth + 1);
  };
  walk(raw, 0);
  const storyboardUrl = thumbnail?.bifUrl || storyboards[0];
  const title = findDisneyContentTitle(raw, disneyPageMediaId()) || undefined;
  const header = readDisneyPlayerHeader(raw) || undefined;
  if (namedDurations.length === 0 && !masterUrl && !storyboardUrl && !title && !header) return null;
  return {
    title,
    header,
    duration: namedDurations.length > 0 ? Math.max(...namedDurations) : undefined,
    masterUrl,
    captions,
    storyboardUrl,
    thumbnail: thumbnail || (storyboardUrl ? { width: 480, height: 270, intervalMs: 10_000, bifUrl: storyboardUrl } : undefined)
  };
}

function resetDisneyHarvest(mediaId?: string): void {
  if (disneyHarvest.bifBlobUrl) {
    try {
      URL.revokeObjectURL(disneyHarvest.bifBlobUrl);
    } catch {
      // Ignore revoke failures for expired harvest blobs.
    }
  }
  disneyHarvest = { mediaId, captions: [] };
  disneyPlaybackTitle = null;
  disneyPlayerHeader = null;
  disneyTitleSource = null;
  disneyTitlePlayId = mediaId || null;
}

function rememberDisneyBif(buffer: ArrayBuffer, url?: string): void {
  if (!disneyIntegrationEnabled()) return;
  if (url && /DUB_CARD/i.test(url)) return;
  if (buffer.byteLength < 80 || buffer.byteLength > MAX_BIF_BYTES) return;
  const count = disneyBifFrameCount(buffer);
  if (count < 8) return;
  if ((disneyHarvest.bifFrameCount || 0) >= count) return;
  if (disneyHarvest.bifBlobUrl) {
    try {
      URL.revokeObjectURL(disneyHarvest.bifBlobUrl);
    } catch {
      // Replace the previous BIF blob.
    }
  }
  disneyHarvest.bifBlobUrl = URL.createObjectURL(new Blob([buffer], { type: 'application/octet-stream' }));
  disneyHarvest.bifFrameCount = count;
  notifyDisneyHarvest();
}

export function harvestDisneyBifFromXhr(xhr: XMLHttpRequest): void {
  try {
    const url = xhr.responseURL || '';
    if (xhr.response instanceof ArrayBuffer) {
      rememberDisneyBif(xhr.response, url);
      return;
    }
    if (xhr.response instanceof Blob) {
      if (xhr.response.size > MAX_BIF_BYTES) return;
      readPageResponseBytes({ body: xhr.response.stream() }, MAX_BIF_BYTES, undefined, disneyIntegrationEnabled)
        .then((buffer) => { if (buffer) rememberDisneyBif(buffer, url); }).catch(() => {});
    }
  } catch {
    // Ignore binary harvest failures from host XHR.
  }
}

function publishDisneyHarvest(): void {
  if (!disneyIntegrationEnabled()) {
    publishHiddenJson(DISNEY_SNAPSHOT_SCRIPT_ID, null);
    return;
  }
  const mediaId = disneyHarvest.mediaId || disneyPageMediaId() || undefined;
  if (!mediaId && !disneyHarvest.masterUrl && !disneyHarvest.storyboardUrl && !disneyHarvest.bifBlobUrl && !disneyHarvest.duration && !disneyHarvest.title) {
    publishHiddenJson(DISNEY_SNAPSHOT_SCRIPT_ID, null);
    return;
  }
  publishHiddenJson(DISNEY_SNAPSHOT_SCRIPT_ID, {
    mediaId,
    title: disneyHarvest.title,
    subtitle: disneyHarvest.subtitle,
    duration: disneyHarvest.duration,
    masterUrl: disneyHarvest.masterUrl,
    storyboardUrl: disneyHarvest.storyboardUrl,
    bifBlobUrl: disneyHarvest.bifBlobUrl,
    thumbnail: disneyHarvest.thumbnail,
    captions: disneyHarvest.captions
  });
}

function notifyDisneyHarvest(): void {
  publishDisneyHarvest();
  if (disneyHarvestNotifyTimer) return;
  disneyHarvestNotifyTimer = window.setTimeout(() => {
    disneyHarvestNotifyTimer = 0;
    window.dispatchEvent(new CustomEvent('theater-everywhere-disney-harvest'));
  }, 50);
}

function mergeDisneyHarvest(next: {
  title?: string;
  header?: DisneyPlayerHeader;
  duration?: number;
  masterUrl?: string;
  captions: Array<{ id: string; language: string; label: string; url: string }>;
  storyboardUrl?: string;
  thumbnail?: { width: number; height: number; intervalMs: number; bifUrl?: string };
}): void {
  const mediaId = disneyPageMediaId();
  if (mediaId && disneyHarvest.mediaId && disneyHarvest.mediaId !== mediaId) {
    resetDisneyHarvest(mediaId);
  }
  if (mediaId) disneyHarvest.mediaId = mediaId;
  let changed = false;
  if (next.title || next.header) {
    if (next.title) disneyPlaybackTitle = next.title;
    if (next.header) disneyPlayerHeader = next.header;
    const resolved = resolveDisneyTitle({
      playId: mediaId,
      previousPlayId: mediaId,
      title: disneyHarvest.title || null,
      source: disneyTitleSource,
      playerHeader: next.header?.title,
      playerChrome: null,
      playbackTitle: next.title,
      documentTitle: null,
      openGraphTitle: null
    });
    disneyTitlePlayId = mediaId;
    if (applyDisneyTitle(resolved)) changed = true;
  }
  if (next.duration && !disneyHarvest.durationFromPlayer && next.duration !== disneyHarvest.duration) {
    disneyHarvest.duration = next.duration;
    changed = true;
  }
  if (next.masterUrl && next.masterUrl !== disneyHarvest.masterUrl) {
    disneyHarvest.masterUrl = next.masterUrl;
    changed = true;
  }
  if (next.storyboardUrl && next.storyboardUrl !== disneyHarvest.storyboardUrl) {
    disneyHarvest.storyboardUrl = next.storyboardUrl;
    changed = true;
  }
  if (next.thumbnail && JSON.stringify(next.thumbnail) !== JSON.stringify(disneyHarvest.thumbnail)) {
    disneyHarvest.thumbnail = next.thumbnail;
    changed = true;
  }
  for (const track of next.captions) {
    if (disneyHarvest.captions.some((item) => item.url === track.url)) continue;
    disneyHarvest.captions.push(track);
    changed = true;
    if (disneyHarvest.captions.length >= 40) break;
  }
  if (changed) notifyDisneyHarvest();
}

export function harvestDisneyData(url: string, data: unknown): void {
  if (!disneyIntegrationEnabled()) return;
  if (!isDisneyHost(window.location.hostname) || (url && !shouldHarvestDisneyUrl(url))) return;
  const extracted = extractDisneyHarvest(data);
  if (extracted) mergeDisneyHarvest(extracted);
}

export function harvestDisneyBody(url: string, body: string): void {
  if (!disneyIntegrationEnabled() || !isDisneyHost(window.location.hostname) || (url && !shouldHarvestDisneyUrl(url)) || !body) return;
  if (body.length > MAX_CAPTION_BYTES) return;
  const trimmed = body.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return;
  if (!/runtimeMillis|runtimeMs|"timedText"|timedTextTracks|trickPlay|subtitle|caption|"bifs"|una-ctr-all|"complete"/i.test(trimmed.slice(0, 8000))
    && !url) return;
  try {
    harvestDisneyData(url, JSON.parse(trimmed));
  } catch {
    // Ignore non-JSON playback bodies.
  }
}

/** Consume the single qualified clone supplied by MAIN. */
export function captureDisneyNetworkResponse(url: string, response: Response): void {
  if (!disneyIntegrationEnabled()) return;
  const finalUrl = (response && response.url) || url;
  if (!response || !response.ok) return;
  if (isAllowedDisneyBifUrl(url) || isAllowedDisneyBifUrl(finalUrl)) {
    readPageResponseBytes(response, MAX_BIF_BYTES, undefined, disneyIntegrationEnabled)
      .then((buffer) => { if (buffer) rememberDisneyBif(buffer, finalUrl || url); }).catch(() => {});
    return;
  }
  if (/\.(m3u8|mp4|m4s|ts|cmfa|cmfv|m4t|jpe?g|png|webp|vtt|bif)(\?|$)/i.test(finalUrl)) return;
  if (!shouldHarvestDisneyUrl(url) && !shouldHarvestDisneyUrl(finalUrl)) return;
  readPageResponseBytes(response, MAX_CAPTION_BYTES, undefined, disneyIntegrationEnabled)
    .then((buffer) => { if (buffer) harvestDisneyBody(finalUrl, new TextDecoder().decode(buffer)); }).catch(() => {});
}

export function readDisneySnapshot(): Record<string, unknown> | null {
  try {
    if (!isDisneyHost(window.location.hostname)) return null;
    const mediaId = disneyPageMediaId() || disneyHarvest.mediaId;
    if (mediaId && disneyHarvest.mediaId && disneyHarvest.mediaId !== mediaId) {
      resetDisneyHarvest(mediaId);
    }
    if (mediaId) disneyHarvest.mediaId = mediaId;
    syncDisneyDisplayedTitle();
    publishDisneyHarvest();
    if (!disneyHarvest.duration && !disneyHarvest.masterUrl && !disneyHarvest.storyboardUrl && !disneyHarvest.bifBlobUrl && !disneyHarvest.title) {
      return mediaId ? { mediaId } : null;
    }
    return {
      mediaId,
      ...(disneyHarvest.title ? { title: disneyHarvest.title, subtitle: disneyHarvest.subtitle } : {}),
      duration: disneyHarvest.duration,
      masterUrl: disneyHarvest.masterUrl,
      storyboardUrl: disneyHarvest.storyboardUrl,
      bifBlobUrl: disneyHarvest.bifBlobUrl,
      thumbnail: disneyHarvest.thumbnail,
      captionTracks: [...disneyHarvest.captions]
    };
  } catch {
    return null;
  }
}

function isDisneyHivePlayer(value: unknown): value is DisneyHivePlayer {
  if (!value || typeof value !== 'object') return false;
  const player = value as DisneyHivePlayer;
  if (typeof player.seek !== 'function') return false;
  return typeof player.play === 'function'
    || typeof player.scrub === 'function'
    || typeof player.timeline?.info?.playheadPositionMs === 'number';
}

function isUsableDisneyMediaVideo(video: HTMLVideoElement | null | undefined): boolean {
  if (!video || !(video instanceof HTMLVideoElement)) return false;
  const className = typeof video.className === 'string' ? video.className : '';
  if (/\bbtm-media-client-element\b/.test(className)) return false;
  let display = '';
  try {
    display = window.getComputedStyle(video).display;
  } catch {
    display = video.style?.display || '';
  }
  if (display === 'none') return false;
  const rect = video.getBoundingClientRect();
  const hasBox = rect.width > 8 && rect.height > 8;
  const hasSource = Boolean(video.currentSrc || video.src);
  if (/\bhive-video\b/.test(className) || /\btheater-everywhere-video-active\b/.test(className) || video.hasAttribute('data-theater-everywhere')) {
    return video.videoWidth > 0 || hasSource || hasBox;
  }
  return (video.videoWidth > 0 || hasSource) && hasBox;
}

function disneyMediaVideos(preferred?: HTMLVideoElement | null): HTMLVideoElement[] {
  const all = Array.from(document.querySelectorAll('video')).filter((node): node is HTMLVideoElement => (
    node instanceof HTMLVideoElement
  ));
  const seen = new Set<HTMLVideoElement>();
  const out: HTMLVideoElement[] = [];
  const push = (node: HTMLVideoElement | null | undefined) => {
    if (!node || seen.has(node) || !isUsableDisneyMediaVideo(node)) return;
    seen.add(node);
    out.push(node);
  };
  push(preferred || null);
  for (const node of all) {
    if (node.classList.contains('theater-everywhere-video-active') || node.hasAttribute('data-theater-everywhere')) push(node);
  }
  for (const node of all) {
    if (node.classList.contains('hive-video')) push(node);
  }
  for (const node of all) push(node);
  return out;
}

function disneyActiveMediaVideo(): HTMLVideoElement | null {
  const active = findActiveVideo(document);
  if (active && isUsableDisneyMediaVideo(active)) return active;
  return disneyMediaVideos()[0] || null;
}

function disneyMediaSeekLooksStuck(video: HTMLVideoElement | null, targetSeconds: number): boolean {
  if (!video || !Number.isFinite(targetSeconds)) return false;
  try {
    if (!video.seekable.length) return targetSeconds > DISNEY_MEDIA_SEEK_STUCK_SECONDS;
    const start = video.seekable.start(0);
    const end = video.seekable.end(video.seekable.length - 1);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > 5) return false;
    return targetSeconds > end + DISNEY_MEDIA_SEEK_STUCK_SECONDS;
  } catch {
    return false;
  }
}

function disneySessionLooksPaused(): boolean {
  const video = disneyActiveMediaVideo();
  return Boolean(video?.paused || document.querySelector('.btm-media-player-idle'));
}

function cancelDisneyResumeAttempts(): void {
  disneyResumeAttemptGeneration += 1;
}

function resumeDisneyAfterBufferedSeek(player: DisneyHivePlayer, video: HTMLVideoElement | null): void {
  const generation = ++disneyResumeAttemptGeneration;
  const resume = () => {
    if (generation !== disneyResumeAttemptGeneration || !disneySessionLooksPaused()) return;
    try {
      player.play?.();
    } catch {
      // The player can reject a resume while its media pipeline is reattaching.
    }
  };

  // Disney+ can emit seek completion before the target segment is playable.
  // Retrying after media readiness covers the buffering path without changing
  // the behavior of a seek that was initiated while paused.
  resume();
  if (video) {
    video.addEventListener('canplay', resume, { once: true });
    video.addEventListener('canplaythrough', resume, { once: true });
  }
  for (const delay of [250, 750, 1_500, 2_500]) {
    window.setTimeout(resume, delay);
  }
}

function applyDisneyHostSeek(
  player: DisneyHivePlayer,
  timeSeconds: number,
  options: { playIfIdle?: boolean; scrub?: boolean }
): void {
  const ms = Math.round(timeSeconds * 1000);
  player.seek(ms);
  if (options.playIfIdle) {
    if (disneySessionLooksPaused()) {
      try {
        player.play?.();
      } catch {
        // Session may still be attaching.
      }
    }
  }
  if (options.scrub) {
    try {
      player.scrub?.(ms);
    } catch {
      // scrub is optional; seek remains the primary API.
    }
  }
}

function invalidateDisneyPlayerCache(): void {
  if (!cachedDisneyPlayer && !cachedDisneyPlayerHost) return;
  cachedDisneyPlayer = null;
  cachedDisneyPlayerHost = null;
  disneyClockTargets = [];
  clockPlayerGeneration += 1;
}

function rememberDisneyPlayer(player: DisneyHivePlayer, host: Element): DisneyHivePlayer | null {
  const playId = disneyPageMediaId();
  if (disneyResettingPlayers.has(player)) return null;
  if (disneyPlayerPlayIds.has(player) && disneyPlayerPlayIds.get(player) !== playId) return null;
  disneyPlayerPlayIds.set(player, playId);
  if (cachedDisneyPlayer !== player) clockPlayerGeneration += 1;
  cachedDisneyPlayer = player;
  cachedDisneyPlayerHost = host;
  return player;
}

function disneyPlayerCacheValid(): boolean {
  if (!cachedDisneyPlayer || !isDisneyHivePlayer(cachedDisneyPlayer)) return false;
  if (disneyResettingPlayers.has(cachedDisneyPlayer)) return false;
  if (disneyPlayerPlayIds.get(cachedDisneyPlayer) !== disneyPageMediaId()) return false;
  if (!cachedDisneyPlayerHost?.isConnected) return false;
  const web = document.querySelector('disney-web-player');
  if (
    web
    && cachedDisneyPlayerHost !== web
    && !web.contains(cachedDisneyPlayerHost)
    && !cachedDisneyPlayerHost.contains(web)
  ) {
    return false;
  }
  return true;
}

function disneyPlayerFromNode(value: unknown): DisneyHivePlayer | null {
  if (isDisneyHivePlayer(value)) return value;
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  for (const key of ['mediaPlayer', 'player', 'hivePlayer']) {
    const nested = record[key];
    if (isDisneyHivePlayer(nested)) return nested;
    if (nested && typeof nested === 'object' && isDisneyHivePlayer((nested as { mediaPlayer?: unknown }).mediaPlayer)) {
      return (nested as { mediaPlayer: DisneyHivePlayer }).mediaPlayer;
    }
  }
  return null;
}

function disneyPlayerFromObject(value: unknown): DisneyHivePlayer | null {
  const named = disneyPlayerFromNode(value);
  if (named) return named;
  if (!value || typeof value !== 'object') return null;
  let keys: string[];
  try {
    keys = Object.keys(value);
  } catch {
    return null;
  }
  for (const key of keys.slice(0, 80)) {
    let candidate: unknown;
    try {
      candidate = (value as Record<string, unknown>)[key];
    } catch {
      continue;
    }
    const found = disneyPlayerFromNode(candidate);
    if (found) return found;
  }
  return null;
}

function disneyPlayerFromFiberHost(host: Element): DisneyHivePlayer | null {
  const fiberKey = Object.keys(host).find((key) => key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$'));
  if (!fiberKey) return null;
  let fiber: { memoizedProps?: unknown; memoizedState?: { memoizedState?: unknown; next?: unknown }; stateNode?: unknown; return?: unknown } | null =
    (host as unknown as Record<string, unknown>)[fiberKey] as typeof fiber;
  let steps = 0;
  while (fiber && steps < 400) {
    steps += 1;
    const fromProps = disneyPlayerFromObject(fiber.memoizedProps);
    if (fromProps) return fromProps;
    let hook = fiber.memoizedState;
    let hookSteps = 0;
    while (hook && hookSteps < 24) {
      const fromHook = disneyPlayerFromObject(hook.memoizedState);
      if (fromHook) return fromHook;
      hook = hook.next as typeof hook;
      hookSteps += 1;
    }
    const fromState = disneyPlayerFromObject(fiber.stateNode);
    if (fromState) return fromState;
    fiber = fiber.return as typeof fiber;
  }
  return null;
}

function findDisneyHivePlayer(video?: HTMLVideoElement | null, refresh = false): DisneyHivePlayer | null {
  if (!refresh && disneyPlayerCacheValid()) return cachedDisneyPlayer;
  const web = document.querySelector('disney-web-player');
  if (web) {
    const fromWeb = disneyPlayerFromFiberHost(web);
    if (fromWeb) {
      const current = rememberDisneyPlayer(fromWeb, web);
      if (current) return current;
    }
  }
  const videos = disneyMediaVideos(video || null);
  for (const node of videos) {
    const attached = disneyPlayerFromNode(node);
    if (attached) {
      const current = rememberDisneyPlayer(attached, node);
      if (current) return current;
    }
    let host: Element | null = node;
    while (host) {
      const fromFiber = disneyPlayerFromFiberHost(host);
      if (fromFiber) {
        const current = rememberDisneyPlayer(fromFiber, host);
        if (current) return current;
      }
      host = host.parentElement;
    }
  }
  invalidateDisneyPlayerCache();
  return null;
}

function disneyPlayheadSeconds(player: DisneyHivePlayer | null): number | null {
  const ms = player?.timeline?.info?.playheadPositionMs;
  return typeof ms === 'number' && Number.isFinite(ms) && ms >= 0 ? ms / 1000 : null;
}

function disneyProgramDurationSeconds(player: DisneyHivePlayer | null): number | null {
  const ms = player?.timeline?.info?.programDurationMs;
  return typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? ms / 1000 : null;
}

/**
 * API runtimes can omit part of the playable timeline. Use the same program
 * length as Hive's content clock so the scrubber does not end early.
 */
function rememberDisneyProgramDuration(player: DisneyHivePlayer | null, playId: string | null): void {
  const seconds = disneyProgramDurationSeconds(player);
  if (seconds == null || !playId) return;
  if (disneyHarvest.mediaId && disneyHarvest.mediaId !== playId) resetDisneyHarvest(playId);
  disneyHarvest.mediaId = playId;
  if (disneyHarvest.durationFromPlayer && disneyHarvest.duration === seconds) return;
  disneyHarvest.duration = seconds;
  disneyHarvest.durationFromPlayer = true;
  notifyDisneyHarvest();
}

function disneyHiveSeekReached(player: DisneyHivePlayer | null, targetSeconds: number): boolean {
  return disneySeekSettlement({
    pendingTarget: targetSeconds,
    playhead: disneyPlayheadSeconds(player),
    pauseAfterSeek: false
  }) !== 'wait';
}

function rememberDisneyClockVideo(video: HTMLVideoElement | null): void {
  if (video && cachedDisneyPlayer && disneyPlayerCacheValid()) disneyVideoPlayers.set(video, cachedDisneyPlayer);
  disneyClockTargets = disneyClockTargets.filter((node) => node.isConnected && node !== video);
  if (video) disneyClockTargets.unshift(video);
  disneyClockTargets = disneyClockTargets.slice(0, 4);
  const current = video && video.isConnected ? video : disneyClockTargets.find((node) => node.isConnected) ?? null;
  watchDisneyClockVideo(current);
}

function watchDisneyClockVideo(video: HTMLVideoElement | null): void {
  if (video === disneyClockVideo) return;
  unwatchDisneyClockVideo?.();
  unwatchDisneyClockVideo = null;
  disneyClockVideo = video;
  if (!video) return;
  const onPlayback = () => ensureDisneyClock();
  let resettingPlayer: DisneyHivePlayer | null = null;
  const onReset = () => {
    resettingPlayer = disneyVideoPlayers.get(video) ?? null;
    if (resettingPlayer) disneyResettingPlayers.add(resettingPlayer);
    if (resettingPlayer === cachedDisneyPlayer) invalidateDisneyPlayerCache();
    ensureDisneyClock();
  };
  const onMetadata = () => {
    // A reused Hive object may adopt the new route only after this video's
    // reset has completed. A URL change or an old timecode alone cannot do it.
    if (resettingPlayer && video.isConnected && video.readyState >= 1) {
      const replacement = findDisneyHivePlayer(video, true);
      if (!replacement) {
        disneyPlayerPlayIds.set(resettingPlayer, disneyPageMediaId());
        disneyResettingPlayers.delete(resettingPlayer);
      }
      resettingPlayer = null;
    }
    ensureDisneyClock();
  };
  video.addEventListener('play', onPlayback);
  video.addEventListener('pause', onPlayback);
  video.addEventListener('emptied', onReset);
  video.addEventListener('loadstart', onReset);
  video.addEventListener('loadedmetadata', onMetadata);
  unwatchDisneyClockVideo = () => {
    video.removeEventListener('play', onPlayback);
    video.removeEventListener('pause', onPlayback);
    video.removeEventListener('emptied', onReset);
    video.removeEventListener('loadstart', onReset);
    video.removeEventListener('loadedmetadata', onMetadata);
  };
}

function readDisneyClockSample(): DisneyClockSample {
  const host = isDisneyHost(window.location.hostname);
  const playId = host ? disneyPageMediaId() : null;
  const player = disneyPlayerCacheValid() ? cachedDisneyPlayer : null;
  const video = disneyClockVideo && disneyClockVideo.isConnected ? disneyClockVideo : null;
  const enabled = host && disneyIntegrationEnabled();
  const mounting = Boolean(
    enabled
    && playId
    && !player
    && disneyMountPlayId === playId
    && performance.now() - disneyMountStartedAt < DISNEY_CLOCK_MOUNT_MS
  );
  return {
    enabled,
    hidden: document.hidden,
    playId,
    playerBound: player != null,
    nativeBound: Boolean(player && disneyClockBoundPlayers.has(player)),
    // Without a video element, keep reading a bound player until play/pause is known.
    paused: video ? video.paused : !player,
    pendingSeek: pendingDisneySeekTarget != null,
    playerGeneration: clockPlayerGeneration,
    playerMounting: mounting
  };
}

/** One bounded look after a wake signal. Later signals start a new window; they do not extend this one. */
function openDisneyMountWindow(playId: string): void {
  if (disneyMountPlayId === playId && performance.now() - disneyMountStartedAt < DISNEY_CLOCK_MOUNT_MS) return;
  disneyMountPlayId = playId;
  disneyMountStartedAt = performance.now();
}

function disneyClock(): DisneyClockScheduler {
  if (!disneyClockScheduler) {
    disneyClockScheduler = createDisneyClockScheduler({
      now: () => performance.now(),
      setInterval: (callback, ms) => window.setInterval(callback, ms),
      clearInterval: (id) => window.clearInterval(id),
      setTimeout: (callback, ms) => window.setTimeout(callback, ms),
      clearTimeout: (id) => window.clearTimeout(id)
    }, {
      sample: readDisneyClockSample,
      perform: performDisneyClockWork
    });
  }
  return disneyClockScheduler;
}

function discoverDisneyClockPlayer(): void {
  if (document.hidden || !disneyIntegrationEnabled() || !isDisneyHost(window.location.hostname)) return;
  if (!disneyPageMediaId()) return;
  // No shell yet: the mount window retries this query. Skip the fiber walk.
  if (!document.querySelector('disney-web-player, video')) return;
  const video = disneyActiveMediaVideo();
  rememberDisneyClockVideo(video);
  const player = findDisneyHivePlayer(video);
  if (video && player) disneyVideoPlayers.set(video, player);
  bindDisneyPlayerClock(player);
}

function performDisneyClockWork(kind: DisneyClockTick): void {
  if (kind === 'discover') {
    discoverDisneyClockPlayer();
    return;
  }
  const player = disneyPlayerCacheValid() ? cachedDisneyPlayer : null;
  if (kind === 'playhead') {
    publishDisneyPlayhead(disneyClockVideo, player);
    return;
  }
  if (player) settleDisneySeek(player);
}

function maybeRefreshDisneyTitle(requested: boolean): void {
  if (document.hidden || !isDisneyHost(window.location.hostname)) return;
  const playId = disneyPageMediaId();
  if (!shouldRefreshDisneyTitle({
    enabled: disneyIntegrationEnabled(),
    playId,
    previousPlayId: disneyTitlePlayId,
    requested
  })) return;
  if (syncDisneyDisplayedTitle()) notifyDisneyHarvest();
}

function ensureDisneyClock(refreshTitle = false): void {
  if (!isDisneyHost(window.location.hostname)) {
    retireDisneySeekIfSessionEnded();
    disneyClock().suspend();
    return;
  }
  retireDisneySeekIfSessionEnded();
  const playId = disneyIntegrationEnabled() && !document.hidden ? disneyPageMediaId() : null;
  if (playId && !disneyPlayerCacheValid()) openDisneyMountWindow(playId);
  maybeRefreshDisneyTitle(refreshTitle);
  disneyClock().sync();
}

function publishDisneyPlayhead(video: HTMLVideoElement | null, player: DisneyHivePlayer | null): number | null {
  const seconds = disneyPlayheadSeconds(player);
  if (seconds == null) return null;
  const playId = disneyPageMediaId();
  rememberDisneyProgramDuration(player, playId);
  if (playId !== lastDispatchedPlayId) {
    lastDispatchedDisneyPlayhead = null;
    lastDispatchedPlayId = playId;
  }
  if (disneyClockTargets.some((node) => !node.isConnected)) {
    disneyClockTargets = disneyClockTargets.filter((node) => node.isConnected);
  }
  const text = String(seconds);
  let wrote = false;
  const targets = new Set<HTMLVideoElement>(disneyClockTargets);
  if (video && video.isConnected) targets.add(video);
  for (const node of targets) {
    let current: string | null = null;
    try {
      current = node.dataset.teDisneyPlayhead ?? null;
    } catch {
      continue;
    }
    if (!disneyPlayheadChanged(current, seconds)) continue;
    try {
      node.dataset.teDisneyPlayhead = text;
      wrote = true;
    } catch {
      // Dataset may be missing on unexpected hosts.
    }
  }
  if (!wrote && lastDispatchedDisneyPlayhead === seconds) return seconds;
  lastDispatchedDisneyPlayhead = seconds;
  window.dispatchEvent(new CustomEvent(DISNEY_CLOCK_EVENT, {
    detail: { time: seconds, mediaId: playId }
  }));
  return seconds;
}

function settleDisneySeek(player: DisneyHivePlayer): void {
  const action = disneySeekSettlement({
    pendingTarget: pendingDisneySeekTarget,
    playhead: disneyPlayheadSeconds(player),
    pauseAfterSeek: pauseDisneyAfterSeek
  });
  if (action === 'wait') return;
  // Drop the pending seek before pausing. Hive pause can emit a video pause
  // event, and that event syncs the clock; completing first keeps it from
  // entering this check again.
  const pause = action === 'complete-and-pause';
  pauseDisneyAfterSeek = false;
  resumeDisneyPlaybackAfterSeek = false;
  pendingDisneySeekTarget = null;
  if (!pause) return;
  try {
    player.pause?.();
  } catch {
    // Ignore pause races after seek.
  }
}

function retireDisneySeekIfSessionEnded(): void {
  const playId = isDisneyHost(window.location.hostname) && disneyIntegrationEnabled()
    ? disneyPageMediaId()
    : null;
  const previous = disneyClockSeekPlayId;
  if (playId === previous) return;
  disneyClockSeekPlayId = playId;
  if (previous == null) return;
  if (pendingDisneySeekTarget == null && !pauseDisneyAfterSeek && !resumeDisneyPlaybackAfterSeek) return;
  pendingDisneySeekTarget = null;
  pauseDisneyAfterSeek = false;
  resumeDisneyPlaybackAfterSeek = false;
  disneySeekGeneration += 1;
  cancelDisneyResumeAttempts();
}

function bindDisneyPlayerClock(player: DisneyHivePlayer | null): void {
  if (!player || typeof player.on !== 'function') return;
  if (disneyClockBoundPlayers.has(player)) return;
  const publish = () => {
    if (cachedDisneyPlayer !== player || !disneyPlayerCacheValid()) return;
    if (
      document.hidden
      || !disneyIntegrationEnabled()
      || !isDisneyHost(window.location.hostname)
      || !disneyPageMediaId()
    ) {
      disneyClock().suspend();
      return;
    }
    publishDisneyPlayhead(disneyClockVideo, player);
    settleDisneySeek(player);
    disneyClock().noteNative();
  };
  try {
    player.on('@EVENT/PLAYER/TIMECODE', publish);
    player.on('@EVENT/PLAYER/PLAYBACK/MEDIA_SEEK_COMPLETE', () => {
      publish();
    });
    player.on('@EVENT/PLAYER/PLAYBACK/MEDIA_RESUMED', publish);
    disneyClockBoundPlayers.add(player);
  } catch {
    // Player event binding can throw if the session is still attaching.
  }
}

export function handleDisneyMediaSeek(
  detail: { live?: boolean; time?: number; resumeAfterSeek?: boolean; cancelPendingResume?: boolean },
  video: Element | null
): boolean {
  if (detail.cancelPendingResume) {
    pauseDisneyAfterSeek = false;
    resumeDisneyPlaybackAfterSeek = false;
    cancelDisneyResumeAttempts();
    disneySeekGeneration += 1;
    if (isDisneyHost(window.location.hostname) && disneyIntegrationEnabled()) ensureDisneyClock();
    return isDisneyHost(window.location.hostname) && disneyIntegrationEnabled();
  }
  if (
    !isDisneyHost(window.location.hostname)
    || !disneyIntegrationEnabled()
    || typeof detail.time !== 'number'
    || !Number.isFinite(detail.time)
  ) {
    return false;
  }
  const mediaVideo = disneyActiveMediaVideo()
    || (video instanceof HTMLVideoElement && isUsableDisneyMediaVideo(video) ? video : null);
  const hive = findDisneyHivePlayer(mediaVideo, true);
  if (hive) {
    // Do not write teDisneyPlayhead to the target here. Captions and the
    // clock follow timeline.info / MEDIA_SEEK_COMPLETE; the scrubber thumb
    // uses pendingMediaSeeks until the host playhead moves.
    const seekGeneration = ++disneySeekGeneration;
    cancelDisneyResumeAttempts();
    pendingDisneySeekTarget = detail.time;
    pauseDisneyAfterSeek = !detail.resumeAfterSeek && disneySessionLooksPaused();
    resumeDisneyPlaybackAfterSeek = detail.resumeAfterSeek === true;
    try {
      bindDisneyPlayerClock(hive);
      applyDisneyHostSeek(hive, detail.time, { playIfIdle: false, scrub: false });
      if (resumeDisneyPlaybackAfterSeek) resumeDisneyAfterBufferedSeek(hive, mediaVideo);
    } catch {
      // Player seek can throw if the session is still attaching.
    }
    window.setTimeout(() => {
      if (seekGeneration !== disneySeekGeneration) return;
      if (pendingDisneySeekTarget == null) return;
      const latestVideo = disneyActiveMediaVideo();
      const latestHive = findDisneyHivePlayer(latestVideo, true);
      if (!latestHive || disneyHiveSeekReached(latestHive, pendingDisneySeekTarget)) return;
      if (!disneyMediaSeekLooksStuck(latestVideo, pendingDisneySeekTarget)) return;
      try {
        applyDisneyHostSeek(latestHive, pendingDisneySeekTarget, { playIfIdle: resumeDisneyPlaybackAfterSeek, scrub: true });
        bindDisneyPlayerClock(latestHive);
      } catch {
        // Retry can fail if the session dropped.
      }
    }, DISNEY_SEEK_RETRY_MS);
    rememberDisneyClockVideo(mediaVideo);
  }
  // A paused scrub still has to publish the landed playhead and settle the
  // seek. That check is the cheap interval; it does not scan for a player.
  ensureDisneyClock();
  return true;
}

function installDisneyClockLifecycle(): void {
  if (disneyClockInstalled) return;
  disneyClockInstalled = true;
  document.addEventListener('visibilitychange', () => ensureDisneyClock(!document.hidden));
  window.addEventListener('popstate', () => ensureDisneyClock());
  window.addEventListener('pagehide', () => disneyClock().suspend());
  window.addEventListener('pageshow', () => ensureDisneyClock(true));
  // Disable is a dataset flag, not a DOM rebuild. Attribute-only observation stays cheap.
  if (document.documentElement) {
    new MutationObserver(() => ensureDisneyClock(true)).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-te-disney-integration-off']
    });
  }
}

export function installDisneyMain(): void {
  window.addEventListener('theater-everywhere-disney-harvest', () => {
    ensureDisneyClock(true);
  });
  if (isDisneyHost(window.location.hostname)) {
    installDisneyClockLifecycle();
    ensureDisneyClock(true);
  }
  installDisneyPlayNext();
}
