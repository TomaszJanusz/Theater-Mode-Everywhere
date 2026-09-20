import { MAX_CAPTION_BYTES } from '../../platform/media-url-policy';
import { mediaProviderIntegrationEnabled } from '../../media-features/provider-flags';
import { findActiveVideo } from '../../platform/active-video';
import { publishHiddenJson } from '../../platform/hidden-json';
import { isDisneyHost } from '../hosts';

export const MAX_BIF_BYTES = 16 * 1024 * 1024;

export function disneyIntegrationEnabled(): boolean {
  return mediaProviderIntegrationEnabled('disney');
}

type DisneyHarvest = {
  mediaId?: string;
  duration?: number;
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
  timeline?: { info?: { playheadPositionMs?: number } };
};

const DISNEY_SNAPSHOT_SCRIPT_ID = 'theater-everywhere-disney-snapshot';
const DISNEY_DURATION_KEY_RE = /^(runtime(millis|ms)?|duration(millis|ms|inms)?|length(millis|ms)?)$/i;
const DISNEY_PLAY_ID_RE = /\/play\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
const DISNEY_CLOCK_EVENT = 'theater-everywhere-disney-clock';
const DISNEY_MEDIA_SEEK_STUCK_SECONDS = 15;
const DISNEY_SEEK_RETRY_MS = 1500;

let disneyHarvest: DisneyHarvest = { captions: [] };
let disneyHarvestNotifyTimer = 0;
let cachedDisneyPlayer: DisneyHivePlayer | null = null;
let cachedDisneyPlayerHost: Element | null = null;
const disneyClockBoundPlayers = new WeakSet<object>();
let disneyClockTimer = 0;
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

function shouldHarvestDisneyUrl(url: string): boolean {
  if (!url) return false;
  if (/\.(m3u8|mp4|m4s|ts|cmfa|cmfv|m4t|jpe?g|png|webp|gif|vtt|bif|js|css|woff2?)(\?|$)/i.test(url)) return false;
  if (/bamgrid\.com|disney-plus\.net/i.test(url)) return true;
  if (/dssott\.com/i.test(url) && /\.json(\?|$)/i.test(url)) return true;
  return /disneyplus\.com/i.test(url) && /\/(playback|session|explore|api)\//i.test(url);
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

export function isAllowedDisneyBifUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !isDssottHostName(parsed.hostname)) return false;
    if (/DUB_CARD/i.test(url)) return false;
    return /\.bif$/i.test(parsed.pathname) && /thumbnails?\//i.test(url);
  } catch {
    return false;
  }
}

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

function extractDisneyHarvest(raw: unknown): {
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
  if (namedDurations.length === 0 && !masterUrl && !storyboardUrl) return null;
  return {
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
      xhr.response.arrayBuffer().then((buffer) => rememberDisneyBif(buffer, url)).catch(() => {});
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
  if (!mediaId && !disneyHarvest.masterUrl && !disneyHarvest.storyboardUrl && !disneyHarvest.bifBlobUrl && !disneyHarvest.duration) {
    publishHiddenJson(DISNEY_SNAPSHOT_SCRIPT_ID, null);
    return;
  }
  publishHiddenJson(DISNEY_SNAPSHOT_SCRIPT_ID, {
    mediaId,
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
  if (next.duration && next.duration !== disneyHarvest.duration) {
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
  if (!isDisneyHost(window.location.hostname) && !shouldHarvestDisneyUrl(url)) return;
  const extracted = extractDisneyHarvest(data);
  if (extracted) mergeDisneyHarvest(extracted);
}

export function harvestDisneyBody(url: string, body: string): void {
  if (!disneyIntegrationEnabled() || !body) return;
  if (body.length > MAX_CAPTION_BYTES) return;
  const trimmed = body.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return;
  if (!shouldHarvestDisneyUrl(url) && !isDisneyHost(window.location.hostname)) return;
  if (!/runtimeMillis|runtimeMs|"timedText"|timedTextTracks|trickPlay|subtitle|caption|"bifs"|una-ctr-all|"complete"/i.test(trimmed.slice(0, 8000))
    && !shouldHarvestDisneyUrl(url)) return;
  try {
    harvestDisneyData(url, JSON.parse(trimmed));
  } catch {
    // Ignore non-JSON playback bodies.
  }
}

export function captureDisneyNetworkResponse(url: string, response: Response): void {
  if (!disneyIntegrationEnabled()) return;
  const finalUrl = (response && response.url) || url;
  if (!response || !response.ok) return;
  if (isAllowedDisneyBifUrl(url) || isAllowedDisneyBifUrl(finalUrl)) {
    response.clone().arrayBuffer().then((buffer) => rememberDisneyBif(buffer, finalUrl || url)).catch(() => {});
    return;
  }
  if (/\.(m3u8|mp4|m4s|ts|cmfa|cmfv|m4t|jpe?g|png|webp|vtt|bif)(\?|$)/i.test(finalUrl)) return;
  if (!shouldHarvestDisneyUrl(url) && !shouldHarvestDisneyUrl(finalUrl)) return;
  response.clone().text().then((text) => harvestDisneyBody(finalUrl, text)).catch(() => {});
}

export function readDisneySnapshot(): Record<string, unknown> | null {
  try {
    if (!isDisneyHost(window.location.hostname)) return null;
    const mediaId = disneyPageMediaId() || disneyHarvest.mediaId;
    if (mediaId && disneyHarvest.mediaId && disneyHarvest.mediaId !== mediaId) {
      resetDisneyHarvest(mediaId);
    }
    if (mediaId) disneyHarvest.mediaId = mediaId;
    publishDisneyHarvest();
    if (!disneyHarvest.duration && !disneyHarvest.masterUrl && !disneyHarvest.storyboardUrl && !disneyHarvest.bifBlobUrl) {
      return mediaId ? { mediaId } : null;
    }
    return {
      mediaId,
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

function rememberDisneyPlayer(player: DisneyHivePlayer, host: Element): DisneyHivePlayer {
  cachedDisneyPlayer = player;
  cachedDisneyPlayerHost = host;
  return player;
}

function disneyPlayerCacheValid(): boolean {
  if (!cachedDisneyPlayer || !isDisneyHivePlayer(cachedDisneyPlayer)) return false;
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
    if (fromWeb) return rememberDisneyPlayer(fromWeb, web);
  }
  const videos = disneyMediaVideos(video || null);
  for (const node of videos) {
    const attached = disneyPlayerFromNode(node);
    if (attached) return rememberDisneyPlayer(attached, node);
    let host: Element | null = node;
    while (host) {
      const fromFiber = disneyPlayerFromFiberHost(host);
      if (fromFiber) return rememberDisneyPlayer(fromFiber, host);
      host = host.parentElement;
    }
  }
  cachedDisneyPlayer = null;
  cachedDisneyPlayerHost = null;
  return null;
}

function disneyPlayheadSeconds(player: DisneyHivePlayer | null): number | null {
  const ms = player?.timeline?.info?.playheadPositionMs;
  return typeof ms === 'number' && Number.isFinite(ms) && ms >= 0 ? ms / 1000 : null;
}

function disneyHiveSeekReached(player: DisneyHivePlayer | null, targetSeconds: number): boolean {
  const playhead = disneyPlayheadSeconds(player);
  return playhead != null && Math.abs(playhead - targetSeconds) <= 2.5;
}

function publishDisneyPlayhead(video: HTMLVideoElement | null, player: DisneyHivePlayer | null): number | null {
  const seconds = disneyPlayheadSeconds(player);
  if (seconds == null) return seconds;
  const videos = new Set<HTMLVideoElement>(disneyMediaVideos(video));
  if (video && isUsableDisneyMediaVideo(video)) videos.add(video);
  for (const node of videos) {
    try {
      node.dataset.teDisneyPlayhead = String(seconds);
    } catch {
      // Dataset may be missing on unexpected hosts.
    }
  }
  window.dispatchEvent(new CustomEvent(DISNEY_CLOCK_EVENT, {
    detail: { time: seconds, mediaId: disneyPageMediaId() }
  }));
  return seconds;
}

function bindDisneyPlayerClock(player: DisneyHivePlayer | null): void {
  if (!player || typeof player.on !== 'function') return;
  if (disneyClockBoundPlayers.has(player)) return;
  const publish = () => {
    publishDisneyPlayhead(disneyActiveMediaVideo(), player);
    if (pendingDisneySeekTarget == null || !disneyHiveSeekReached(player, pendingDisneySeekTarget)) return;
    if (pauseDisneyAfterSeek) {
      try {
        player.pause?.();
      } catch {
        // Ignore pause races after seek.
      }
    }
    pauseDisneyAfterSeek = false;
    resumeDisneyPlaybackAfterSeek = false;
    pendingDisneySeekTarget = null;
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

function ensureDisneyClock(): void {
  if (!isDisneyHost(window.location.hostname) || !disneyIntegrationEnabled()) return;
  const video = disneyActiveMediaVideo();
  const player = findDisneyHivePlayer(video);
  bindDisneyPlayerClock(player);
  publishDisneyPlayhead(video, player);
  if (disneyClockTimer) return;
  disneyClockTimer = window.setInterval(() => {
    if (!disneyIntegrationEnabled()) return;
    const active = disneyActiveMediaVideo();
    const next = findDisneyHivePlayer(active);
    bindDisneyPlayerClock(next);
    publishDisneyPlayhead(active, next);
  }, 250);
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
  }
  return true;
}

export function installDisneyMain(): void {
  window.addEventListener('theater-everywhere-disney-harvest', () => {
    ensureDisneyClock();
  });
  if (isDisneyHost(window.location.hostname)) {
    ensureDisneyClock();
  }
}
