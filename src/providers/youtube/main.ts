import {
  createTimedtextCacheRecord,
  findCachedTimedtextBody,
  signYoutubeCaptionUrl,
  timedtextHasPot,
  timedtextVideoId,
  youtubePageVideoId,
  type CachedTimedtext
} from '../../media-features/youtube-caption-url';
import { isAllowedMediaFetchUrl, MAX_CAPTION_BYTES } from '../../platform/media-url-policy';
import { mediaProviderIntegrationEnabled } from '../../media-features/provider-flags';
import { publishHiddenJson } from '../../platform/hidden-json';

export function youtubeIntegrationEnabled(): boolean {
  return mediaProviderIntegrationEnabled('youtube');
}

const timedtextBodies: CachedTimedtext[] = [];
const YOUTUBE_SNAPSHOT_SCRIPT_ID = 'theater-everywhere-youtube-snapshot';
const YOUTUBE_CAPTION_AUTH_ID = 'theater-everywhere-youtube-caption-auth';
let captionMintInFlight: Promise<string | null> | null = null;
const lastCaptionMintFailedAt = new Map<string, number>();

function isAuxiliaryYoutubePlayer(el: Element | null): boolean {
  if (!el) return true;
  if (el.id === 'shorts-player' || el.id === 'inline-player' || el.id === 'inline-preview-player') return true;
  return Boolean(el.closest('ytd-shorts, ytd-video-preview, ytd-miniplayer, [hidden]'));
}

function findYoutubePlayer(): any {
  const movie = document.getElementById('movie_player');
  if (movie && !isAuxiliaryYoutubePlayer(movie)) return movie;
  const players = Array.from(document.querySelectorAll('.html5-video-player'));
  return players.find((el) => !isAuxiliaryYoutubePlayer(el)) || movie || players[0] || null;
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
  const pageId = youtubePageVideoId(window.location.href);
  const want = videoId || pageId;
  const urls = [
    ...timedtextUrlsFromPerformance(),
    ...timedtextBodies.map((item) => item.url)
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
    const urls = youtubeCaptionAuthSources(youtubePageVideoId(window.location.href));
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

export function cacheTimedtextBody(url: string, body: string): void {
  if (!url || !body || body.length > MAX_CAPTION_BYTES || !/timedtext/i.test(url)) return;
  const record = createTimedtextCacheRecord(url, body);
  if (!record) return;
  const last = timedtextBodies[timedtextBodies.length - 1];
  if (last && last.url === record.url && last.body === record.body) return;
  timedtextBodies.push(record);
  if (timedtextBodies.length > 20) timedtextBodies.shift();
  publishYoutubeCaptionAuth();
  if (window !== window.top) {
    try {
      window.top?.postMessage({ type: 'theater-everywhere-timedtext-body', record }, '*');
    } catch {
      // Cross-origin embeds cannot share the caption cache.
    }
  }
}

function findCachedBody(url: string): string | null {
  return findCachedTimedtextBody(timedtextBodies, url);
}

export function captureTimedtextResponse(url: string, response: Response): void {
  const finalUrl = (response && response.url) || url;
  if (!finalUrl || !/timedtext/i.test(finalUrl) || !response || !response.ok) return;
  response.clone().text().then((text) => {
    if (text) cacheTimedtextBody(finalUrl, text);
  }).catch(() => {});
}

function captionTrackFromPlayer(languageCode: string | null, kind: string | null): Record<string, unknown> | null {
  const player = findYoutubePlayer();
  const list = player?.getOption?.('captions', 'tracklist');
  const tracks = Array.isArray(list) ? list : [];
  const matches = languageCode
    ? tracks.filter((track: any) => track && track.languageCode === languageCode)
    : tracks;
  if (kind) {
    const exact = matches.find((track: any) => track.kind === kind);
    if (exact) return exact;
  } else {
    const manual = matches.find((track: any) => !track.kind);
    if (manual) return manual;
  }
  if (matches[0]) return matches[0];
  if (languageCode) {
    const track: Record<string, string> = { languageCode };
    if (kind) track.kind = kind;
    return track;
  }
  return null;
}

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function waitForCaptionTracklist(player: any, timeoutMs = 2000): Promise<any[]> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      player?.loadModule?.('captions');
    } catch {
      // Module may already be loaded.
    }
    const list = player?.getOption?.('captions', 'tracklist');
    if (Array.isArray(list) && list.length > 0) return list;
    await waitMs(100);
  }
  const list = player?.getOption?.('captions', 'tracklist');
  return Array.isArray(list) ? list : [];
}

async function ensureYoutubeCaptions(
  languageCode: string | null,
  kind: string | null,
  forceReset = false
): Promise<boolean> {
  const button = document.querySelector('.ytp-subtitles-button') as HTMLElement | null;
  const player = findYoutubePlayer();
  if (forceReset) {
    try {
      player?.unloadModule?.('captions');
    } catch {
      // Player may not expose unloadModule.
    }
    disableYoutubeCaptions();
    await waitMs(80);
  }
  try {
    player?.loadModule?.('captions');
  } catch {
    // Module may already be loaded.
  }
  await waitForCaptionTracklist(player);
  try {
    const track = captionTrackFromPlayer(languageCode, kind);
    if (track && typeof player?.setOption === 'function') {
      player.setOption('captions', 'track', track);
      return true;
    }
  } catch {
    // Fall through to the control button.
  }
  const alreadyOn = button?.getAttribute('aria-pressed') === 'true';
  if (!alreadyOn && button) {
    button.click();
    return true;
  }
  try {
    if (!alreadyOn && typeof player?.toggleSubtitles === 'function') {
      player.toggleSubtitles();
      return true;
    }
  } catch {
    return false;
  }
  return alreadyOn;
}

function disableYoutubeCaptions(): void {
  const button = document.querySelector('.ytp-subtitles-button') as HTMLElement | null;
  if (button?.getAttribute('aria-pressed') === 'true') {
    button.click();
    return;
  }
  try {
    findYoutubePlayer()?.setOption?.('captions', 'track', {});
  } catch {
    // Native captions can stay off without this.
  }
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
  const candidates: string[] = [];
  const add = (value: string) => {
    if (value && !candidates.includes(value) && isAllowedTimedtextUrl(value)) candidates.push(value);
  };
  const videoId = timedtextVideoId(url) || youtubePageVideoId(window.location.href);
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
    try {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 4000);
      const response = await fetch(candidate, { credentials: 'include', signal: controller.signal });
      window.clearTimeout(timer);
      if (!response.ok) continue;
      const text = await response.text();
      if (!text || text.trim().length < 20) continue;
      const start = text.trim().slice(0, 80).toLowerCase();
      if (start.startsWith('<!doctype') || start.startsWith('<html')) continue;
      cacheTimedtextBody(candidate, text);
      return text;
    } catch {
      // Try the next signed caption URL.
    }
  }
  return null;
}

export async function fetchTimedtextWithPot(url: string): Promise<string | null> {
  if (!youtubeIntegrationEnabled()) return null;
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

  captionMintInFlight = (async () => {
    let languageCode: string | null = null;
    let kind: string | null = null;
    try {
      const parsed = new URL(url, window.location.href);
      languageCode = parsed.searchParams.get('lang');
      kind = parsed.searchParams.get('kind');
    } catch {
      languageCode = null;
    }
    await ensureYoutubeCaptions(languageCode, kind, true);
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
  const videoId = (raw as { videoDetails?: { videoId?: unknown } }).videoDetails?.videoId;
  return typeof videoId === 'string' ? videoId : null;
}

function pickYoutubePlayerResponse(): unknown {
  const win = window as any;
  let live: unknown = null;
  try {
    live = findYoutubePlayer()?.getPlayerResponse?.() || null;
  } catch {
    live = null;
  }
  const boot = win.ytInitialPlayerResponse || null;
  let config: unknown = null;
  try {
    if (win.ytplayer?.config?.args?.raw_player_response) {
      config = win.ytplayer.config.args.raw_player_response;
    } else if (typeof win.ytplayer?.config?.args?.player_response === 'string') {
      config = JSON.parse(win.ytplayer.config.args.player_response);
    }
  } catch {
    config = null;
  }
  const pageId = youtubePageVideoId(window.location.href);
  const candidates = [live, boot, config].filter((item) => item && typeof item === 'object');
  const matching = candidates.find((item) => {
    const videoId = youtubeResponseVideoId(item);
    return videoId && (!pageId || videoId === pageId);
  });
  if (matching) return matching;
  // Playlist advances update ?v= before getPlayerResponse(). Returning the
  // previous video here would keep stale storyboards in theater chrome.
  return pageId ? null : (live || boot || config);
}

export function readYoutubeSnapshot(): Record<string, unknown> | null {
  try {
    const raw = pickYoutubePlayerResponse() as any;
    if (!raw || typeof raw !== 'object') return null;

    const videoDetails = raw.videoDetails || {};
    const captionTracks = (raw.captions?.playerCaptionsTracklistRenderer?.captionTracks || [])
      .slice(0, 40)
      .map((track: any, index: number) => {
        const baseUrl = typeof track?.baseUrl === 'string' ? track.baseUrl : '';
        if (!baseUrl || baseUrl.length > 32000) return null;
        const language = String(track.languageCode || '').slice(0, 16);
        const label = String(track.name?.simpleText || track.name?.runs?.[0]?.text || language).slice(0, 80);
        return {
          id: `youtube:${String(track.vssId || language || index).slice(0, 40)}`,
          language,
          label,
          kind: track.kind === 'asr' ? 'captions' : 'subtitles',
          autoGenerated: track.kind === 'asr',
          baseUrl
        };
      })
      .filter(Boolean);

    const markers = raw.markersMap
      ? Object.values(raw.markersMap as Record<string, any>)
          .flatMap((entry) => entry?.value?.chapters || entry?.chapters || [])
          .slice(0, 80)
          .map((chapter: any) => ({
            startMillis: Number(chapter?.chapterRenderer?.timeRangeStartMillis ?? chapter?.startMillis),
            title: typeof chapter?.chapterRenderer?.title?.simpleText === 'string'
              ? chapter.chapterRenderer.title.simpleText.slice(0, 120)
              : (typeof chapter?.title?.simpleText === 'string' ? chapter.title.simpleText.slice(0, 120) : undefined)
          }))
      : [];

    const description = typeof videoDetails.shortDescription === 'string'
      ? videoDetails.shortDescription.slice(0, 20000)
      : undefined;

    return {
      videoId: typeof videoDetails.videoId === 'string' ? videoDetails.videoId.slice(0, 20) : undefined,
      duration: Number(videoDetails.lengthSeconds) || undefined,
      description,
      captionTracks,
      storyboardSpec: typeof raw.storyboards?.playerStoryboardSpecRenderer?.spec === 'string'
        ? raw.storyboards.playerStoryboardSpecRenderer.spec.slice(0, 4000)
        : undefined,
      markers
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

function youtubeWallNow(player: any): number | null {
  const now = Number(player?.querySelector?.('.ytp-progress-bar')?.getAttribute('aria-valuenow'));
  return Number.isFinite(now) ? now : null;
}

function youtubeWallLiveHead(player: any): number | null {
  const max = Number(player?.querySelector?.('.ytp-progress-bar')?.getAttribute('aria-valuemax'));
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
      const liveBadge = player?.querySelector?.('.ytp-live-badge');
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
  window.addEventListener('message', (event: MessageEvent) => {
    if (window !== window.top) return;
    const data = event.data;
    if (data && data.type === 'theater-everywhere-timedtext-body' && data.record && typeof data.record.body === 'string') {
      timedtextBodies.push(data.record as CachedTimedtext);
      if (timedtextBodies.length > 20) timedtextBodies.shift();
    }
  });

  ['yt-navigate-finish', 'yt-page-data-updated', 'yt-player-updated'].forEach((name) => {
    window.addEventListener(name, publishCurrentYoutubeSnapshot);
    document.addEventListener(name, publishCurrentYoutubeSnapshot);
  });
  [0, 300, 1000, 2500].forEach((ms) => {
    window.setTimeout(publishCurrentYoutubeSnapshot, ms);
  });

  window.addEventListener('theater-everywhere-youtube-captions', (event: Event) => {
    const detail = (event as CustomEvent<{ requestId?: number; enabled?: boolean; language?: string; kind?: string | null }>).detail || {};
    const requestId = detail.requestId;
    const respond = (ok: boolean) => {
      window.dispatchEvent(new CustomEvent('theater-everywhere-youtube-captions-result', {
        detail: { requestId, ok }
      }));
    };
    try {
      if (!youtubeIntegrationEnabled()) {
        respond(false);
        return;
      }
      if (detail.enabled) {
        void ensureYoutubeCaptions(detail.language || null, detail.kind || null, true);
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
