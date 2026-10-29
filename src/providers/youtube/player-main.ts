import { readPageResponseBytes } from '../../platform/page-body';
import { qualifiesYoutubeHeatmap } from '../network-harvest';
import { fetchPageMedia } from '../../platform/page-fetch';
import { isChildFrameMessage } from '../../protocol/frame-messages';
import {
  createTimedtextCacheRecord,
  selectCaptionTrackOption,
  signYoutubeCaptionUrl,
  timedtextHasPot,
  timedtextVideoId,
  youtubePageVideoId,
  type CachedTimedtext
} from '../../media-features/youtube-caption-url';
import { findYoutubeChapterMarkers } from '../../media-features/parsers/youtube-chapters';
import {
  findYoutubeHeatmap,
  youtubeHeatmapHarvestMatchesPage,
  youtubeWatchJsonVideoId,
  type YoutubeHeatmap
} from '../../media-features/parsers/youtube-heatmap';
import { isAllowedMediaFetchUrl, MAX_CAPTION_BYTES } from '../../platform/media-url-policy';
import { discoverParentOrigin } from '../../platform/parent-origin';
import { mediaProviderIntegrationEnabled } from '../../media-features/provider-flags';
import { sanitizeContentTitle } from '../../media-features/content-title';
import { readYoutubePlayerMetadata, youtubeRecord } from '../../media-features/parsers/youtube-player-response';
import { publishHiddenJson } from '../../platform/hidden-json';
import { parseYoutubeCaptions } from '../../protocol/page-requests';
import { isYouTubeHost } from '../hosts';
import { MINIPLAYER_SURFACE } from '../video-candidates';
import { installYouTubeAudio } from './audio-main';
import { youtubePlayerControl } from './player-controls';
import { installYouTubeQueueNavigation } from './queue-main';
import {
  createTimedtextBodyCache,
  MAX_TIMEDTEXT_STRING_LENGTH,
  TIMEDTEXT_CACHE_STRING_BUDGET
} from './timedtext-cache';
import { youtubeWatchPlayback } from './watch-playback';

export function youtubeIntegrationEnabled(): boolean {
  return mediaProviderIntegrationEnabled('youtube');
}

const timedtextCache = createTimedtextBodyCache();
const timedtextAuthUrls: string[] = [];
const YOUTUBE_SNAPSHOT_SCRIPT_ID = 'theater-everywhere-youtube-snapshot';
const YOUTUBE_CAPTION_AUTH_ID = 'theater-everywhere-youtube-caption-auth';
let captionMintInFlight: Promise<string | null> | null = null;
const lastCaptionMintFailedAt = new Map<string, number>();
let youtubeHeatmapHarvest: (YoutubeHeatmap & { videoId: string | null }) | null = null;
let youtubeHarvestNotifyTimer = 0;

function notifyYoutubeHarvest(): void {
  if (youtubeHarvestNotifyTimer) return;
  youtubeHarvestNotifyTimer = window.setTimeout(() => {
    youtubeHarvestNotifyTimer = 0;
    window.dispatchEvent(new CustomEvent('theater-everywhere-youtube-harvest'));
  }, 80);
}

/**
 * The content id YouTube data must describe. Off a watch URL nothing identifies the video, and
 * nothing is checked (`strict` false, `id` null), except while the player is parked in the
 * miniplayer: then data must match that player's own confirmed id, it is unknown (null) while
 * the player reads disagree, and page DOM, which describes the page, never stands in for it.
 * The isolated adapter applies the same rule with the id it reads through the miniplayer bridge.
 */
type ExpectedVideo = { id: string | null; strict: boolean };

function expectedYoutubeVideo(): ExpectedVideo {
  const pageId = youtubePageVideoId(window.location.href);
  if (pageId || !document.querySelector(`${MINIPLAYER_SURFACE} #movie_player`)) return { id: pageId, strict: false };
  return { id: youtubeWatchPlayback.miniplayerVideo?.(document)?.identity ?? null, strict: true };
}

/** Whether data reporting `videoId` (null when it reports none) may describe the expected video. */
function describesExpected(expected: ExpectedVideo, videoId: string | null | undefined): boolean {
  if (expected.strict) return expected.id !== null && videoId === expected.id;
  return !expected.id || !videoId || videoId === expected.id;
}

function rememberYoutubeHeatmap(found: YoutubeHeatmap, videoId: string | null): boolean {
  const segments = found.segments || [];
  const prev = youtubeHeatmapHarvest;
  const same = Boolean(
    prev
    && prev.videoId === videoId
    && prev.source === found.source
    && prev.segments?.length === segments.length
    && prev.segments?.[0]?.startMs === segments[0]?.startMs
    && prev.segments?.[0]?.intensity === segments[0]?.intensity
    && prev.segments?.[segments.length - 1]?.intensity === segments[segments.length - 1]?.intensity
    && prev.floor === found.floor
  );
  youtubeHeatmapHarvest = { ...found, videoId, segments };
  return !same;
}

function dropStaleYoutubeHeatmapHarvest(expected: ExpectedVideo): void {
  if (youtubeHeatmapHarvest && expected.id && youtubeHeatmapHarvest.videoId && youtubeHeatmapHarvest.videoId !== expected.id) {
    youtubeHeatmapHarvest = null;
  }
}

function heatmapPayload(found: YoutubeHeatmap): YoutubeHeatmap {
  return {
    source: found.source,
    ...(found.segments ? { segments: found.segments } : {}),
    ...(found.floor && found.floor > 0 ? { floor: found.floor } : {})
  };
}

/**
 * `findYoutubeHeatmap` walks up to tens of thousands of nodes, and every snapshot publish (load
 * timers, YouTube events, harvests) asked the same page and player objects again. YouTube replaces
 * those objects when content changes instead of editing them, and a heatmap delivered later arrives
 * through the harvested response, so a result stays valid for its root object and expected id.
 */
const heatmapWalks = new WeakMap<object, Map<string, YoutubeHeatmap | null>>();

function findYoutubeHeatmapOnce(root: unknown, pageId: string | null): YoutubeHeatmap | null {
  if (!root || typeof root !== 'object') return null;
  let byPage = heatmapWalks.get(root);
  if (!byPage) {
    byPage = new Map();
    heatmapWalks.set(root, byPage);
  }
  const key = pageId ?? '';
  const known = byPage.get(key);
  if (known !== undefined) return known;
  const found = findYoutubeHeatmap(root, pageId);
  byPage.set(key, found);
  return found;
}

function heatmapForCurrentPage(playerRaw: unknown, expected: ExpectedVideo): YoutubeHeatmap | undefined {
  dropStaleYoutubeHeatmapHarvest(expected);
  const pageId = expected.id;
  const win = window as Window & { ytInitialData?: unknown };
  const fromInitial = findYoutubeHeatmapOnce(win.ytInitialData, pageId);
  const initialId = youtubeWatchJsonVideoId(win.ytInitialData);
  if (fromInitial?.segments && youtubeHeatmapHarvestMatchesPage(pageId, initialId) && describesExpected(expected, initialId)) {
    rememberYoutubeHeatmap(fromInitial, pageId || initialId);
    return heatmapPayload(fromInitial);
  }
  const fromPlayer = findYoutubeHeatmapOnce(playerRaw, pageId);
  const playerId = youtubeWatchJsonVideoId(playerRaw) || youtubeResponseVideoId(playerRaw);
  if (fromPlayer?.segments && youtubeHeatmapHarvestMatchesPage(pageId, playerId) && describesExpected(expected, playerId)) {
    rememberYoutubeHeatmap(fromPlayer, pageId || playerId);
    return heatmapPayload(fromPlayer);
  }
  if (
    youtubeHeatmapHarvest?.segments
    && youtubeHeatmapHarvestMatchesPage(pageId, youtubeHeatmapHarvest.videoId)
    && describesExpected(expected, youtubeHeatmapHarvest.videoId)
  ) {
    return heatmapPayload(youtubeHeatmapHarvest);
  }
  return undefined;
}

export function harvestYoutubeHeatmapJson(url: string, data: unknown): void {
  if (!qualifiesYoutubeHeatmap(window.location.hostname, youtubeIntegrationEnabled(), url, window.location.href)) return;
  const expected = expectedYoutubeVideo();
  const pageId = expected.id;
  const found = findYoutubeHeatmap(data, pageId);
  if (!found?.segments) return;
  const jsonId = youtubeWatchJsonVideoId(data);
  if (!youtubeHeatmapHarvestMatchesPage(pageId, jsonId) || !describesExpected(expected, jsonId)) return;
  const changed = rememberYoutubeHeatmap(found, pageId || jsonId);
  if (!changed) return;
  publishCurrentYoutubeSnapshot();
  notifyYoutubeHarvest();
}

export function harvestYoutubeHeatmapText(url: string, text: string): void {
  if (!qualifiesYoutubeHeatmap(window.location.hostname, youtubeIntegrationEnabled(), url, window.location.href)) return;
  if (!text || text.length > 8_000_000 || !/^\s*[\[{]/.test(text)) return;
  if (
    !text.includes('MARKER_TYPE_HEATMAP')
    && !text.includes('HEATSEEKER')
    && !text.includes('heatmapRenderer')
  ) return;
  try {
    harvestYoutubeHeatmapJson(url, JSON.parse(text));
  } catch {
    // Host body was not JSON.
  }
}

function isAuxiliaryYoutubePlayer(el: Element | null): boolean {
  if (!el) return true;
  if (el.id === 'shorts-player' || el.id === 'inline-player' || el.id === 'inline-preview-player') return true;
  return Boolean(el.closest('ytd-shorts, ytd-video-preview, ytd-miniplayer, [hidden]'));
}

type YoutubePlayer = Element & {
  getOption?: (module: string, option: string) => unknown;
  setOption?: (module: string, option: string, value: Record<string, unknown>) => void;
  loadModule?: (module: string) => void;
  unloadModule?: (module: string) => void;
  toggleSubtitles?: () => void;
  getPlayerResponse?: () => unknown;
  setSize?: (width: number, height: number) => void;
  seekTo?: (time: number, allowSeekAhead: boolean) => void;
  seekToLiveHead?: () => void;
};

/** Hover and inline previews: their player responses never describe the viewer's video. */
function isPreviewYoutubePlayer(el: Element): boolean {
  return el.id === 'inline-player' || el.id === 'inline-preview-player'
    || Boolean(el.closest('ytd-video-preview, ytd-moving-thumbnail-renderer, ytd-inline-playback-player'));
}

function findYoutubePlayer(): YoutubePlayer | null {
  const movie = document.getElementById('movie_player');
  if (movie && !isAuxiliaryYoutubePlayer(movie)) return movie;
  const players = Array.from(document.querySelectorAll('.html5-video-player'));
  // Then the player parked in the miniplayer while it shows, then a hidden watch page or Shorts
  // player; never a preview's.
  return players.find((el) => !isAuxiliaryYoutubePlayer(el))
    || document.querySelector(`${MINIPLAYER_SURFACE} .html5-video-player`)
    || (movie && !isPreviewYoutubePlayer(movie) ? movie : null)
    || players.find((el) => !isPreviewYoutubePlayer(el))
    || null;
}

function publishYoutubeSnapshot(snapshot: Record<string, unknown> | null): void {
  publishHiddenJson(YOUTUBE_SNAPSHOT_SCRIPT_ID, snapshot);
}

function timedtextUrlsFromPerformance(): string[] {
  try {
    return performance.getEntriesByType('resource')
      .map((entry) => entry.name)
      .filter((name) => /\/api\/timedtext/i.test(name));
  } catch {
    return [];
  }
}

function youtubeCaptionAuthSources(videoId: string | null): string[] {
  const pageId = expectedYoutubeVideo().id;
  const want = videoId || pageId;
  const urls = [
    ...timedtextUrlsFromPerformance(),
    ...timedtextCache.records().map((item) => item.url),
    ...timedtextAuthUrls
  ];
  const out: string[] = [];
  for (const url of urls.reverse()) {
    if (!timedtextHasPot(url)) continue;
    const id = timedtextVideoId(url);
    if (want && id && id !== want) continue;
    if (pageId && id && id !== pageId) continue;
    if (!out.includes(url)) out.push(url);
  }
  return out;
}

function publishYoutubeCaptionAuth(): void {
  try {
    if (!youtubeIntegrationEnabled()) {
      publishHiddenJson(YOUTUBE_CAPTION_AUTH_ID, null);
      return;
    }
    const urls = youtubeCaptionAuthSources(expectedYoutubeVideo().id);
    publishHiddenJson(YOUTUBE_CAPTION_AUTH_ID, urls.slice(0, 8));
  } catch {
    // Publishing must never break the host player.
  }
}

export function publishCurrentYoutubeSnapshot(): void {
  try {
    publishYoutubeSnapshot(youtubeIntegrationEnabled() ? readYoutubeSnapshot() : null);
    publishYoutubeCaptionAuth();
  } catch {
    // Publishing must never break the host player.
  }
}

function rememberTimedtextAuthUrl(url: string): void {
  const index = timedtextAuthUrls.indexOf(url);
  if (index >= 0) timedtextAuthUrls.splice(index, 1);
  timedtextAuthUrls.push(url);
  if (timedtextAuthUrls.length > 8) timedtextAuthUrls.shift();
  publishYoutubeCaptionAuth();
}

export function harvestTimedtextJson(url: string, data: unknown): void {
  if (!youtubeIntegrationEnabled() || !isYouTubeHost() || !isAllowedTimedtextUrl(url)) return;
  if (!Array.isArray(youtubeRecord(data)?.events)) return;
  // Native JSON3 is already parsed. Preserve the signed URL without turning
  // the object back into a string just to populate the textual body cache.
  rememberTimedtextAuthUrl(url);
  const record = createTimedtextCacheRecord(url, '');
  if (record) postTimedtextToTop(record);
}

export function cacheTimedtextBody(url: string, body: string): void {
  // String.length is UTF-16 code units. The network read is capped separately
  // by MAX_CAPTION_BYTES (UTF-8 bytes) before decode.
  if (!url || !body || body.length > MAX_TIMEDTEXT_STRING_LENGTH || !/timedtext/i.test(url)) return;
  const record = createTimedtextCacheRecord(url, body);
  if (!record) return;
  const stored = timedtextCache.put(record);
  if (stored === 'unchanged') return;
  if (timedtextHasPot(record.url)) rememberTimedtextAuthUrl(record.url);
  else if (stored === 'stored') publishYoutubeCaptionAuth();
  if (stored === 'stored') postTimedtextToTop(record);
}

function postTimedtextToTop(record: CachedTimedtext): void {
  if (window === window.top) return;
  const target = discoverParentOrigin();
  if (!target) return;
  try {
    if (!isYouTubeHost(new URL(target).hostname)) return;
    window.top?.postMessage({ type: 'theater-everywhere-timedtext-body', record }, target);
  } catch {
    // Cross-origin embeds cannot share the caption cache.
  }
}

function findCachedBody(url: string): string | null {
  return timedtextCache.find(url);
}

export function readCachedTimedtextBody(url: string): string | null {
  return findCachedBody(url);
}

export function readTimedtextCacheUsage(): { retainedStringLength: number; stringBudget: number; tracks: number } {
  return {
    retainedStringLength: timedtextCache.retainedStringLength(),
    stringBudget: TIMEDTEXT_CACHE_STRING_BUDGET,
    tracks: timedtextCache.trackCount()
  };
}

/** Consume the single qualified clone supplied by MAIN. */
export function captureTimedtextResponse(url: string, response: Response): void {
  const finalUrl = (response && response.url) || url;
  if (!finalUrl || !/timedtext/i.test(finalUrl) || !response || !response.ok) return;
  const generation = captionOperation;
  readPageResponseBytes(response, MAX_CAPTION_BYTES, undefined,
    () => generation === captionOperation && youtubeIntegrationEnabled()).then((buffer) => {
    if (buffer) cacheTimedtextBody(finalUrl, new TextDecoder().decode(buffer));
  }).catch(() => {});
}

let captionOperation = 0;

function invalidateYoutubeCaptions(): void {
  captionOperation += 1;
  timedtextCache.notePageVideo(expectedYoutubeVideo().id);
}

function playerCaptionTracks(player: YoutubePlayer): Record<string, unknown>[] {
  const list = typeof player.getOption === 'function' ? player.getOption('captions', 'tracklist') : null;
  return Array.isArray(list) ? list.flatMap((value) => {
    const track = youtubeRecord(value);
    return track && typeof track.languageCode === 'string'
      && (track.kind === undefined || typeof track.kind === 'string') ? [track] : [];
  }) : [];
}

function captionTrackFromPlayer(
  player: YoutubePlayer,
  languageCode: string | null,
  kind: string | null,
  translationCode: string | null
): Record<string, unknown> | null {
  return selectCaptionTrackOption(playerCaptionTracks(player), languageCode, kind, translationCode);
}

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function waitForCaptionTracklist(player: YoutubePlayer, current: () => boolean, timeoutMs = 2000): Promise<void> {
  const started = Date.now();
  while (current() && Date.now() - started < timeoutMs) {
    try {
      if (typeof player.loadModule === 'function') player.loadModule('captions');
    } catch {
      // Module may already be loaded.
    }
    if (playerCaptionTracks(player).length > 0) return;
    await waitMs(100);
  }
}

function captionRequestIsCurrent(player: YoutubePlayer | null, generation: number): () => boolean {
  if (!player) return () => false;
  const video = player.querySelector('video');
  const currentSrc = video?.currentSrc || '';
  const source = video?.getAttribute('src');
  const sourceObject = video?.srcObject;
  const expected = expectedYoutubeVideo();
  const pageId = expected.id;
  const responseId = typeof player.getPlayerResponse === 'function' ? youtubeResponseVideoId(player.getPlayerResponse()) : null;
  if (!describesExpected(expected, responseId)) return () => false;
  return () => generation === captionOperation
    && youtubeIntegrationEnabled()
    && findYoutubePlayer() === player
    && player.querySelector('video') === video
    && (video?.currentSrc || '') === currentSrc
    && video?.getAttribute('src') === source
    && video?.srcObject === sourceObject
    && expectedYoutubeVideo().id === pageId
    && (typeof player.getPlayerResponse === 'function' ? youtubeResponseVideoId(player.getPlayerResponse()) : null) === responseId;
}

async function ensureYoutubeCaptions(
  languageCode: string | null,
  kind: string | null,
  translationCode: string | null,
  forceReset = false
): Promise<boolean> {
  const generation = ++captionOperation;
  const player = findYoutubePlayer();
  if (!player) return false;
  const current = captionRequestIsCurrent(player, generation);
  const button = player.querySelector<HTMLElement>('.ytp-subtitles-button');
  if (!current()) return false;
  if (forceReset) {
    try {
      if (typeof player.unloadModule === 'function') player.unloadModule('captions');
    } catch {
      // Player may not expose unloadModule.
    }
    disablePlayerCaptions(player, button);
    await waitMs(80);
    if (!current()) return false;
  }
  await waitForCaptionTracklist(player, current);
  if (!current()) return false;
  try {
    const track = captionTrackFromPlayer(player, languageCode, kind, translationCode);
    if (track && typeof player.setOption === 'function') {
      player.setOption('captions', 'track', track);
      return true;
    }
  } catch {
    // Fall through to the control button.
  }
  if (!current()) return false;
  const alreadyOn = button?.getAttribute('aria-pressed') === 'true';
  if (!alreadyOn && button?.isConnected && player.contains(button)) {
    button.click();
    return true;
  }
  if (!alreadyOn && typeof player.toggleSubtitles === 'function') {
    player.toggleSubtitles();
    return true;
  }
  return alreadyOn;
}

function disablePlayerCaptions(player: YoutubePlayer | null, button: HTMLElement | null): void {
  if (!player?.isConnected || findYoutubePlayer() !== player) return;
  if (button?.isConnected && player.contains(button) && button.getAttribute('aria-pressed') === 'true') {
    button.click();
    return;
  }
  try {
    if (typeof player?.setOption === 'function') player.setOption('captions', 'track', {});
  } catch {
    // Native captions can stay off without this.
  }
}

function disableYoutubeCaptions(): void {
  invalidateYoutubeCaptions();
  const player = findYoutubePlayer();
  disablePlayerCaptions(player, player?.querySelector<HTMLElement>('.ytp-subtitles-button') || null);
}

function waitForCachedBody(url: string, timeoutMs: number): Promise<string | null> {
  const started = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      const found = findCachedBody(url);
      if (found) {
        resolve(found);
        return;
      }
      if (Date.now() - started >= timeoutMs) {
        resolve(null);
        return;
      }
      window.setTimeout(tick, 80);
    };
    tick();
  });
}

export function isAllowedTimedtextUrl(url: string): boolean {
  return isAllowedMediaFetchUrl({ provider: 'youtube', kind: 'caption-track', url }, window.location.href);
}

async function fetchTimedtextDirect(url: string): Promise<string | null> {
  const href = window.location.href;
  const generation = captionOperation;
  const current = () => window.location.href === href && generation === captionOperation && youtubeIntegrationEnabled();
  const candidates: string[] = [];
  const add = (value: string) => {
    if (value && !candidates.includes(value) && isAllowedTimedtextUrl(value)) candidates.push(value);
  };
  const videoId = timedtextVideoId(url) || expectedYoutubeVideo().id;
  const signed = signYoutubeCaptionUrl(url, youtubeCaptionAuthSources(videoId));
  publishYoutubeCaptionAuth();
  add(signed);
  try {
    const parsed = new URL(signed, window.location.href);
    parsed.searchParams.set('fmt', 'json3');
    add(parsed.toString());
  } catch {
    // Keep the original caption URL.
  }
  if (!timedtextHasPot(signed)) return null;
  for (const candidate of candidates.slice(0, 4)) {
    if (!current()) return null;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 4000);
    try {
      const response = await fetchPageMedia(candidate, { credentials: 'include', signal: controller.signal });
      if (!response) continue;
      const buffer = await readPageResponseBytes(response, MAX_CAPTION_BYTES, controller.signal, current);
      if (!buffer) continue;
      const text = new TextDecoder().decode(buffer);
      if (!text || text.trim().length < 20) continue;
      const start = text.trim().slice(0, 80).toLowerCase();
      if (start.startsWith('<!doctype') || start.startsWith('<html')) continue;
      cacheTimedtextBody(candidate, text);
      return text;
    } catch {
      // Try the next signed caption URL.
    } finally {
      window.clearTimeout(timer);
    }
  }
  return null;
}

export async function fetchTimedtextWithPot(url: string): Promise<string | null> {
  if (!youtubeIntegrationEnabled()) return null;
  const current = captionRequestIsCurrent(findYoutubePlayer(), captionOperation);
  const requestedVideoId = timedtextVideoId(url);
  const cached = findCachedBody(url);
  if (cached) return cached;
  const direct = await fetchTimedtextDirect(url);
  if (direct) return direct;
  const videoId = timedtextVideoId(url) || url;
  const failedAt = lastCaptionMintFailedAt.get(videoId) || 0;
  if (Date.now() - failedAt < 1500) return findCachedBody(url);
  if (captionMintInFlight) {
    await captionMintInFlight;
    const afterWait = findCachedBody(url);
    if (afterWait) return afterWait;
  }

  if (!current()) return findCachedBody(url);
  const expected = expectedYoutubeVideo();
  if (requestedVideoId ? !describesExpected(expected, requestedVideoId) : expected.strict && !expected.id) return null;

  captionMintInFlight = (async () => {
    let languageCode: string | null = null;
    let kind: string | null = null;
    let translationCode: string | null = null;
    try {
      const parsed = new URL(url, window.location.href);
      languageCode = parsed.searchParams.get('lang');
      kind = parsed.searchParams.get('kind');
      translationCode = parsed.searchParams.get('tlang');
    } catch {
      languageCode = null;
    }
    if (!await ensureYoutubeCaptions(languageCode, kind, translationCode, true)) return null;
    return waitForCachedBody(url, 8000);
  })();

  try {
    const body = await captionMintInFlight;
    if (!body) lastCaptionMintFailedAt.set(videoId, Date.now());
    else lastCaptionMintFailedAt.delete(videoId);
    return body;
  } finally {
    captionMintInFlight = null;
  }
}

function youtubeResponseVideoId(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const videoId = youtubeRecord(youtubeRecord(raw)?.videoDetails)?.videoId;
  return typeof videoId === 'string' ? videoId : null;
}

function pickYoutubePlayerResponse(expected: ExpectedVideo): unknown {
  const win = window as Window & { ytInitialPlayerResponse?: unknown; ytplayer?: unknown };
  let live: unknown = null;
  try {
    const player = findYoutubePlayer();
    live = typeof player?.getPlayerResponse === 'function' ? player.getPlayerResponse() : null;
  } catch {
    live = null;
  }
  const boot = win.ytInitialPlayerResponse || null;
  let config: unknown = null;
  try {
    const args = youtubeRecord(youtubeRecord(youtubeRecord(win.ytplayer)?.config)?.args);
    if (args?.raw_player_response) {
      config = args.raw_player_response;
    } else if (typeof args?.player_response === 'string') {
      config = JSON.parse(args.player_response);
    }
  } catch {
    config = null;
  }
  const pageId = expected.id;
  const candidates = [live, boot, config].filter((item) => item && typeof item === 'object');
  const matching = candidates.find((item) => {
    const videoId = youtubeResponseVideoId(item);
    return videoId && describesExpected(expected, videoId);
  });
  if (matching) return matching;
  // Playlist advances update ?v= before getPlayerResponse(). Returning the
  // previous video here would keep stale storyboards in theater chrome.
  return pageId || expected.strict ? null : (live || boot || config);
}

function usableYoutubeDomTitle(value: string | null): string | null {
  if (!value || /^youtube$/i.test(value)) return null;
  return value;
}

function readYoutubeDomTitle(): string | null {
  const heading = document.querySelector(
    'h1.ytd-watch-metadata yt-formatted-string, h1.ytd-watch-metadata, #title h1, .ytp-title-link'
  );
  const fromHeading = usableYoutubeDomTitle(sanitizeContentTitle(heading?.textContent));
  if (fromHeading) return fromHeading;
  const og = usableYoutubeDomTitle(sanitizeContentTitle(
    document.querySelector('meta[name="title"], meta[property="og:title"]')?.getAttribute('content')
  ));
  if (og) return og;
  return usableYoutubeDomTitle(sanitizeContentTitle(document.title.replace(/\s+-\s+YouTube$/i, '')));
}

export function readYoutubeSnapshot(): Record<string, unknown> | null {
  try {
    const expected = expectedYoutubeVideo();
    const raw = pickYoutubePlayerResponse(expected);
    const metadata = readYoutubePlayerMetadata(raw);
    const heatmap = heatmapForCurrentPage(raw, expected);
    // The watch heading, og:title and document title describe the page, which a parked player is not.
    const domTitle = (!expected.strict && readYoutubeDomTitle()) || undefined;
    if (!metadata) {
      if (!heatmap && !domTitle) return null;
      const videoId = expected.id;
      return {
        ...(videoId ? { videoId: videoId.slice(0, 20) } : {}),
        ...(domTitle ? { title: domTitle } : {}),
        ...(heatmap ? { heatmap } : {})
      };
    }

    const playerVideoId = metadata.videoId || null;
    let markers = findYoutubeChapterMarkers(raw);
    if (markers.length === 0) {
      const win = window as Window & { ytInitialData?: unknown };
      const initialId = youtubeWatchJsonVideoId(win.ytInitialData);
      const wantId = expected.id || playerVideoId;
      // ytInitialData is the page's: a parked player's chapters come from it only when it names that video.
      if (expected.strict ? initialId === wantId : !wantId || !initialId || initialId === wantId) {
        markers = findYoutubeChapterMarkers(win.ytInitialData);
      }
    }

    return {
      ...metadata,
      ...(metadata.title || domTitle ? { title: metadata.title || domTitle } : {}),
      markers,
      ...(heatmap ? { heatmap } : {})
    };
  } catch {
    return null;
  }
}

function refreshYoutubePlayerLayout(): void {
  const player = findYoutubePlayer();
  if (!player || typeof player.clientWidth !== 'number') return;
  const width = player.clientWidth;
  const height = player.clientHeight;
  if (width <= 0 || height <= 0) return;

  const chrome = player.querySelector?.('.ytp-chrome-bottom');
  if (chrome instanceof HTMLElement) {
    const chromeWidth = chrome.getBoundingClientRect().width;
    if (chromeWidth > width + 16) {
      chrome.style.removeProperty('width');
      chrome.style.removeProperty('left');
    }
  }

  try {
    if (typeof player.setSize === 'function') {
      player.setSize(width, height);
    }
  } catch {
    // Watch-page player may not expose setSize.
  }
}

function youtubeProgressBar(player: YoutubePlayer | null): Element | null {
  return player ? youtubePlayerControl(player, '.ytp-progress-bar') : null;
}

function youtubeWallNow(player: YoutubePlayer | null): number | null {
  const now = Number(youtubeProgressBar(player)?.getAttribute('aria-valuenow'));
  return Number.isFinite(now) ? now : null;
}

function youtubeWallLiveHead(player: YoutubePlayer | null): number | null {
  const max = Number(youtubeProgressBar(player)?.getAttribute('aria-valuemax'));
  return Number.isFinite(max) ? max : null;
}

export function handleYoutubeMediaSeek(detail: { live?: boolean; time?: number }, video: Element | null): boolean {
  const player = findYoutubePlayer();
  try {
    if (detail.live === true) {
      const liveHead = youtubeWallLiveHead(player);
      if (typeof player?.seekTo === 'function' && liveHead != null) {
        player.seekTo(liveHead, true);
      }
      if (typeof player?.seekToLiveHead === 'function') {
        player.seekToLiveHead();
      }
      return true;
    }
    if (typeof detail.time === 'number' && Number.isFinite(detail.time) && typeof player?.seekTo === 'function') {
      const videoEl = video instanceof HTMLVideoElement ? video : null;
      const html5Now = videoEl ? videoEl.currentTime : NaN;
      const wallNow = youtubeWallNow(player);
      const wallMax = youtubeWallLiveHead(player);
      const liveBadge = player ? youtubePlayerControl(player, '.ytp-live-badge') : null;
      const atLiveHead = Boolean(liveBadge?.classList?.contains('ytp-live-badge-is-livehead'));
      const stored = videoEl ? Number(videoEl.dataset.teYtWallOffset) : NaN;
      const ariaBehind = wallMax != null && wallNow != null ? wallMax - wallNow : NaN;
      let offset = NaN;
      if (atLiveHead && wallMax != null && Number.isFinite(html5Now)) {
        offset = wallMax - html5Now;
      } else if (Number.isFinite(ariaBehind) && ariaBehind > 2 && wallNow != null && Number.isFinite(html5Now)) {
        offset = wallNow - html5Now;
      } else if (Number.isFinite(stored)) {
        offset = stored;
      } else if (wallNow != null && Number.isFinite(html5Now)) {
        offset = wallNow - html5Now;
      }
      // Prefer the mapping content already stored. Wall and HTML5 clocks
      // disagree while a DVR seek is in flight.
      if (Number.isFinite(stored) && Number.isFinite(offset) && Math.abs(offset - stored) > 5) {
        offset = stored;
      }
      if (Number.isFinite(offset)) {
        player.seekTo(detail.time + offset, true);
        return true;
      }
    }
  } catch {
    // Watch-page player may not expose live seek helpers.
  }
  return false;
}

export function publishYoutubeProbeSnapshot(snapshot: Record<string, unknown> | null): void {
  publishYoutubeSnapshot(snapshot);
}

export function installYoutubeMain(): void {
  installYouTubeQueueNavigation();
  installYouTubeAudio();
  timedtextCache.notePageVideo(expectedYoutubeVideo().id);
  window.addEventListener('message', (event: MessageEvent) => {
    if (window !== window.top) return;
    try {
      if (!isYouTubeHost(new URL(event.origin).hostname)) return;
    } catch {
      return;
    }
    const data = youtubeRecord(event.data);
    const record = youtubeRecord(data?.record);
    if (data?.type === 'theater-everywhere-timedtext-body' && typeof record?.body === 'string') {
      if (!isChildFrameMessage(event)) return;
      if (typeof record.url !== 'string' || !isAllowedTimedtextUrl(record.url) || record.body.length > MAX_TIMEDTEXT_STRING_LENGTH) return;
      const cached = createTimedtextCacheRecord(record.url, record.body);
      if (!cached) return;
      if (!cached.body) { rememberTimedtextAuthUrl(cached.url); return; }
      const stored = timedtextCache.put(cached);
      if (stored === 'unchanged') return;
      if (timedtextHasPot(cached.url)) rememberTimedtextAuthUrl(cached.url);
      else if (stored === 'stored') publishYoutubeCaptionAuth();
    }
  });

  ['yt-navigate-start', 'yt-navigate-finish', 'yt-page-data-updated', 'yt-player-updated'].forEach((name) => {
    window.addEventListener(name, invalidateYoutubeCaptions);
    document.addEventListener(name, invalidateYoutubeCaptions);
  });
  document.addEventListener('loadstart', (event) => {
    if (event.target === findYoutubePlayer()?.querySelector('video')) invalidateYoutubeCaptions();
  }, true);

  ['yt-navigate-finish', 'yt-page-data-updated', 'yt-player-updated'].forEach((name) => {
    window.addEventListener(name, publishCurrentYoutubeSnapshot);
    document.addEventListener(name, publishCurrentYoutubeSnapshot);
  });
  [0, 300, 1000, 2500].forEach((ms) => {
    window.setTimeout(publishCurrentYoutubeSnapshot, ms);
  });

  window.addEventListener('theater-everywhere-youtube-captions', (event: Event) => {
    const request = parseYoutubeCaptions((event as CustomEvent<unknown>).detail);
    if (!request) return;
    const { requestId } = request;
    const respond = (ok: boolean) => {
      window.dispatchEvent(new CustomEvent('theater-everywhere-youtube-captions-result', {
        detail: { requestId, ok }
      }));
    };
    try {
      if (!youtubeIntegrationEnabled()) {
        if (!request.enabled) invalidateYoutubeCaptions();
        respond(false);
        return;
      }
      if (request.enabled) {
        void ensureYoutubeCaptions(
          request.language ?? null,
          request.kind ?? null,
          request.translation ?? null,
          true
        ).then(respond, () => respond(false));
        return;
      } else {
        disableYoutubeCaptions();
      }
      respond(true);
    } catch {
      respond(false);
    }
  });

  window.addEventListener('theater-everywhere-host-layout-refresh', () => {
    refreshYoutubePlayerLayout();
  });
}
