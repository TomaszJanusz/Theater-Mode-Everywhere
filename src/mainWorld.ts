import { createTimedtextCacheRecord, findCachedTimedtextBody, signYoutubeCaptionUrl, timedtextHasPot, timedtextVideoId, youtubePageVideoId, type CachedTimedtext } from './media-features/youtube-caption-url';
import { classifyMediaFetchUrl, isAllowedMediaFetchUrl, isAllowedPageFetchUrl as isAllowlistedPageFetchUrl } from './media-features/fetch-allowlist';
import { createWorldMessage, isSameWindowMessage, readWorldEnvelope } from './protocol/world-messages';
import { markFetchPatched, markMainWorldBooted, shouldPatchMainWorld } from './providers/registry';

(function() {
  if (!shouldPatchMainWorld(window.location.hostname)) return;
  if (!markMainWorldBooted(window)) return;

  const MAX_CAPTION_BYTES = 2 * 1024 * 1024;
  const MAX_BIF_BYTES = 16 * 1024 * 1024;
  const timedtextBodies: CachedTimedtext[] = [];
  let twitchHarvest: {
    videoId?: string;
    duration?: number;
    seekPreviewsURL?: string;
    moments: Array<{ startTime: number; endTime?: number; title: string }>;
  } = { moments: [] };
  let twitchHarvestNotifyTimer = 0;
  let disneyHarvest: {
    mediaId?: string;
    duration?: number;
    masterUrl?: string;
    storyboardUrl?: string;
    bifBlobUrl?: string;
    bifFrameCount?: number;
    thumbnail?: { width: number; height: number; intervalMs: number; bifUrl?: string };
    captions: Array<{ id: string; language: string; label: string; url: string }>;
  } = { captions: [] };
  let disneyHarvestNotifyTimer = 0;

  function youtubeIntegrationEnabled(): boolean {
    return !document.documentElement.hasAttribute('data-te-youtube-integration-off');
  }

  function vimeoIntegrationEnabled(): boolean {
    return !document.documentElement.hasAttribute('data-te-vimeo-integration-off');
  }

  function patreonIntegrationEnabled(): boolean {
    return !document.documentElement.hasAttribute('data-te-patreon-integration-off');
  }

  function twitchIntegrationEnabled(): boolean {
    return !document.documentElement.hasAttribute('data-te-twitch-integration-off');
  }

  function disneyIntegrationEnabled(): boolean {
    return !document.documentElement.hasAttribute('data-te-disney-integration-off');
  }

  function requestUrl(input: RequestInfo | URL): string {
    if (typeof input === 'string') return input;
    if (input instanceof URL) return input.toString();
    if (input && typeof input === 'object' && 'url' in input) return String((input as Request).url);
    return '';
  }

  function cacheTimedtextBody(url: string, body: string): void {
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

  function captureTimedtextResponse(url: string, response: Response): void {
    const finalUrl = (response && response.url) || url;
    if (!finalUrl || !/timedtext/i.test(finalUrl) || !response || !response.ok) return;
    response.clone().text().then((text) => {
      if (text) cacheTimedtextBody(finalUrl, text);
    }).catch(() => {});
  }

  function captureTwitchNetworkResponse(url: string, response: Response): void {
    if (!twitchIntegrationEnabled()) return;
    const finalUrl = (response && response.url) || url;
    if (response && response.ok && isAllowedTwitchStoryboardUrl(finalUrl)) {
      rememberTwitchStoryboardUrl(finalUrl);
    }
    if (!response || !response.ok) return;
    if (!/gql\.twitch\.tv/i.test(finalUrl) && !/gql\.twitch\.tv/i.test(url)) return;
    response.clone().text().then((text) => harvestTwitchGqlBody(text)).catch(() => {});
  }

  function captureDisneyNetworkResponse(url: string, response: Response): void {
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

  const FETCH_WRAPPED = Symbol.for('theater-everywhere.wrapped-fetch');

  function wrapFetch(fn: typeof fetch): typeof fetch {
    const tagged = fn as typeof fetch & { [FETCH_WRAPPED]?: boolean };
    if (tagged[FETCH_WRAPPED]) return fn;
    const wrapped = function(this: Window, input: RequestInfo | URL): Promise<Response> {
      const url = requestUrl(input);
      return Promise.resolve(fn.apply(this, arguments as unknown as [RequestInfo | URL, RequestInit?])).then((response) => {
        try {
          const clone = response.clone();
          captureTimedtextResponse(url, clone);
          captureTwitchNetworkResponse(url, clone);
          captureDisneyNetworkResponse(url, clone);
        } catch {
          // Harvest must not break the page's fetch.
        }
        return response;
      });
    } as typeof fetch & { [FETCH_WRAPPED]?: boolean };
    wrapped[FETCH_WRAPPED] = true;
    return wrapped;
  }

  if (markFetchPatched(window)) {
  const originalResponseJson = Response.prototype.json;
  Response.prototype.json = function(this: Response) {
    const result = originalResponseJson.apply(this, arguments as unknown as []);
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      (result as Promise<unknown>).then((data) => {
        try {
          const url = this.url || '';
          if (twitchIntegrationEnabled() && /gql\.twitch\.tv/i.test(url)) {
            harvestTwitchGqlBody(JSON.stringify(data));
          }
          harvestDisneyData(url, data);
        } catch {
          // Ignore harvest failures from host JSON parsing.
        }
      }).catch(() => {});
    }
    return result;
  };

  const originalResponseText = Response.prototype.text;
  Response.prototype.text = function(this: Response) {
    const result = originalResponseText.apply(this, arguments as unknown as []);
    if (result && typeof (result as Promise<string>).then === 'function') {
      (result as Promise<string>).then((text) => {
        try {
          if (!text) return;
          const url = this.url || '';
          if (twitchIntegrationEnabled() && (/gql\.twitch\.tv/i.test(url) || /"positionMilliseconds"|"seekPreviewsURL"/.test(text.slice(0, 4000)))) {
            if (isTwitchHostName(window.location.hostname) || /gql\.twitch\.tv/i.test(url)) {
              harvestTwitchGqlBody(text);
            }
          }
          harvestDisneyBody(url, text);
        } catch {
          // Ignore harvest failures from host text parsing.
        }
      }).catch(() => {});
    }
    return result;
  };

  let currentFetch = wrapFetch(window.fetch.bind(window));
  try {
    Object.defineProperty(window, 'fetch', {
      configurable: true,
      enumerable: true,
      get() {
        return currentFetch;
      },
      set(next: typeof fetch) {
        currentFetch = typeof next === 'function' ? wrapFetch(next) : next;
      }
    });
  } catch {
    window.fetch = currentFetch;
  }

  const originalXhrOpen = XMLHttpRequest.prototype.open;
  const originalXhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(this: XMLHttpRequest) {
    (this as XMLHttpRequest & { _theaterTimedtextUrl?: string })._theaterTimedtextUrl = String(arguments[1] || '');
    return originalXhrOpen.apply(this, arguments as unknown as Parameters<XMLHttpRequest['open']>);
  };
  XMLHttpRequest.prototype.send = function(this: XMLHttpRequest) {
    this.addEventListener('loadend', function(this: XMLHttpRequest) {
      const url = this.responseURL || (this as XMLHttpRequest & { _theaterTimedtextUrl?: string })._theaterTimedtextUrl || '';
      if (this.status < 200 || this.status >= 300) return;
      if (disneyIntegrationEnabled() && isAllowedDisneyBifUrl(url)) harvestDisneyBifFromXhr(this);
      const body = isAllowedDisneyBifUrl(url) ? null : xhrResponseText(this);
      if (body) cacheTimedtextBody(url, body);
      if (body && /gql\.twitch\.tv/i.test(url)) harvestTwitchGqlBody(body);
      if (isAllowedTwitchStoryboardUrl(url)) rememberTwitchStoryboardUrl(url);
      if (body) harvestDisneyBody(url, body);
      if (!body && /gql\.twitch\.tv/i.test(url) && this.responseType === 'blob' && this.response instanceof Blob) {
        this.response.text().then((text) => harvestTwitchGqlBody(text)).catch(() => {});
      }
    });
    return originalXhrSend.apply(this, arguments as unknown as Parameters<XMLHttpRequest['send']>);
  };

  function xhrResponseText(xhr: XMLHttpRequest): string | null {
    try {
      if (xhr.responseType === '' || xhr.responseType === 'text') {
        return typeof xhr.responseText === 'string' && xhr.responseText ? xhr.responseText : null;
      }
      if (xhr.responseType === 'json') {
        if (typeof xhr.response === 'string') return xhr.response || null;
        if (xhr.response && typeof xhr.response === 'object') return JSON.stringify(xhr.response);
      }
      if (xhr.responseType === 'arraybuffer' && xhr.response instanceof ArrayBuffer) {
        return new TextDecoder().decode(xhr.response);
      }
    } catch {
      return null;
    }
    return null;
  }
  }

  window.addEventListener('message', (event: MessageEvent) => {
    if (window !== window.top) return;
    const data = event.data;
    if (data && data.type === 'theater-everywhere-timedtext-body' && data.record && typeof data.record.body === 'string') {
      timedtextBodies.push(data.record as CachedTimedtext);
      if (timedtextBodies.length > 20) timedtextBodies.shift();
    }
    if (data && data.type === 'theater-everywhere-twitch-harvest-body' && typeof data.body === 'string') {
      try {
        if (!isTwitchHostName(new URL(event.origin).hostname)) return;
      } catch {
        return;
      }
      harvestTwitchGqlBody(data.body);
    }
  });

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

  const YOUTUBE_SNAPSHOT_SCRIPT_ID = 'theater-everywhere-youtube-snapshot';
  const YOUTUBE_CAPTION_AUTH_ID = 'theater-everywhere-youtube-caption-auth';

  function publishHiddenJson(id: string, payload: unknown | null): void {
    const existing = document.getElementById(id);
    if (payload == null) {
      existing?.remove();
      return;
    }
    const el = existing || document.createElement('div');
    el.id = id;
    el.setAttribute('hidden', '');
    el.textContent = JSON.stringify(payload);
    if (!existing) {
      (document.documentElement || document.head || document.body)?.appendChild(el);
    }
  }

  function publishYoutubeSnapshot(snapshot: Record<string, unknown> | null): void {
    publishHiddenJson(YOUTUBE_SNAPSHOT_SCRIPT_ID, snapshot);
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

  function publishCurrentYoutubeSnapshot(): void {
    try {
      publishYoutubeSnapshot(youtubeIntegrationEnabled() ? readYoutubeSnapshot() : null);
      publishYoutubeCaptionAuth();
    } catch {
      // Publishing must never break the host player.
    }
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

  let captionMintInFlight: Promise<string | null> | null = null;
  const lastCaptionMintFailedAt = new Map<string, number>();

  function timedtextUrlsFromPerformance(): string[] {
    try {
      return performance.getEntriesByType('resource')
        .map((entry) => entry.name)
        .filter((name) => /\/api\/timedtext/i.test(name));
    } catch {
      return [];
    }
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

  async function fetchTimedtextWithPot(url: string): Promise<string | null> {
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
  function findActiveVideo(root: Document | ShadowRoot): HTMLVideoElement | null {
    if (!root) return null;
    const video = root.querySelector('.theater-everywhere-video-active');
    if (video && video.tagName === 'VIDEO') return video as HTMLVideoElement;

    const hosts = root.querySelectorAll('*');
    for (const host of hosts) {
      if (host instanceof HTMLElement && host.shadowRoot) {
        const v = findActiveVideo(host.shadowRoot);
        if (v) return v;
      }
    }
    return null;
  }

  // Track video that needs AudioContext setup (deferred until real user gesture)
  let pendingVideo: HTMLVideoElement | null = null;
  let pendingMultiplier: number = 1.0;
  // Videos where Web Audio setup failed — don't retry
  const failedVideos = new WeakSet<HTMLVideoElement>();

  function setupAudioGraph(video: HTMLVideoElement): boolean {
    const boosted = video as any;
    if (boosted._theaterGainNode) {
      video.dataset.theaterBoostReady = 'true';
      return true; // Already initialized
    }
    if (failedVideos.has(video)) return false; // Previously failed

    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return false;

      const ctx = new AudioCtx();
      // crossOrigin is set preemptively in enterTheaterMode (content script),
      // so this should work without CORS issues.
      const source = ctx.createMediaElementSource(video);
      const gain = ctx.createGain();

      source.connect(gain);
      gain.connect(ctx.destination);

      boosted._theaterAudioCtx = ctx;
      boosted._theaterGainNode = gain;
      video.dataset.theaterBoostReady = 'true';
      window.dispatchEvent(new CustomEvent('theater-everywhere-boost-ready'));

      // Apply pending multiplier
      if (pendingVideo === video) {
        gain.gain.value = pendingMultiplier;
        pendingVideo = null;
      }

      if (ctx.state === 'suspended') {
        ctx.resume().catch(console.error);
      }

      return true;
    } catch (err) {
      console.error('[Theater Everywhere Main World] Web Audio setup failed:', err);
      failedVideos.add(video);
      return false;
    }
  }

  function applyPendingBoost(): void {
    if (!pendingVideo) return;
    setupAudioGraph(pendingVideo);
  }

  function resumeIfSuspended(): void {
    const video = findActiveVideo(document);
    if (!video) return;

    const ctx = (video as any)._theaterAudioCtx;
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(console.error);
    }
  }

  // Create/resume AudioContext on REAL user gestures (these carry user activation tokens).
  const onUserGesture = () => {
    applyPendingBoost();
    resumeIfSuspended();
  };

  window.addEventListener('click', onUserGesture, { capture: true, passive: true });
  window.addEventListener('keydown', onUserGesture, { capture: true, passive: true });
  window.addEventListener('pointerdown', onUserGesture, { capture: true, passive: true });

  function isEditableKeyboardTarget(target: EventTarget | null): boolean {
    const el = target instanceof HTMLElement ? target : document.activeElement as HTMLElement | null;
    if (!el) return false;
    const tag = el.tagName;
    if (tag === 'TEXTAREA') return true;
    if (tag === 'INPUT') {
      const type = (el as HTMLInputElement).type;
      return !['range', 'checkbox', 'radio', 'button', 'submit', 'image', 'file'].includes(type);
    }
    return el.isContentEditable || el.getAttribute('role') === 'textbox';
  }

  function mediaHasSource(video: HTMLVideoElement): boolean {
    if (video.currentSrc || video.src || video.srcObject) return true;
    return Boolean(video.querySelector('source[src]'));
  }

  function looksLikeHostPlayButton(el: HTMLElement): boolean {
    if (el.id === 'theater-everywhere-ui' || el.closest('#theater-everywhere-ui')) return false;
    const className = el.className.toString();
    if (/\b(?:ytp-large-play-button|vjs-big-play-button|plyr__control--overlaid)\b/.test(className)) {
      return true;
    }
    const aria = (el.getAttribute('aria-label') || '').trim();
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    return /^(play|odtwórz|odtworz)(\s*\([^)]*\))?$/i.test(aria)
      || /^(play|odtwórz|odtworz)(\s*\([^)]*\))?$/i.test(text);
  }

  function findHostPlayButton(video: HTMLVideoElement): HTMLElement | null {
    const scan = (root: ParentNode): HTMLElement | null => {
      const candidates = root.querySelectorAll(
        'button, [role="button"], .ytp-large-play-button, .vjs-big-play-button, .plyr__control--overlaid'
      );
      for (const node of candidates) {
        if (node instanceof HTMLElement && looksLikeHostPlayButton(node)) return node;
      }
      return null;
    };
    let node: Node | null = video.parentNode;
    while (node) {
      if (node instanceof Element || node instanceof Document || node instanceof ShadowRoot) {
        const found = scan(node);
        if (found) return found;
      }
      node = node instanceof ShadowRoot ? node.host : node.parentNode;
    }
    return null;
  }

  function requestVideoPlay(video: HTMLVideoElement): void {
    if (mediaHasSource(video)) {
      video.play().catch(() => {});
      return;
    }
    const hostPlay = findHostPlayButton(video);
    if (hostPlay) hostPlay.click();
  }

  function swallowTheaterPlaybackKeys(event: KeyboardEvent): void {
    const video = document.querySelector('.theater-everywhere-video-active');
    if (!(video instanceof HTMLVideoElement)) return;
    if (isEditableKeyboardTarget(event.target) || isEditableKeyboardTarget(document.activeElement)) return;
    const isSpace = event.key === ' ' || event.code === 'Space';
    if (!isSpace) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if (event.type !== 'keydown' || event.repeat) return;

    const wantPaused = mediaHasSource(video) && !video.paused;
    if (wantPaused) video.pause();
    else requestVideoPlay(video);
    window.dispatchEvent(new CustomEvent('theater-everywhere-playback-intent', {
      detail: { action: wantPaused ? 'pause' : 'play' }
    }));
  }

  window.addEventListener('keydown', swallowTheaterPlaybackKeys, true);
  window.addEventListener('keyup', swallowTheaterPlaybackKeys, true);
  window.addEventListener('keypress', swallowTheaterPlaybackKeys, true);

  // Also listen to 'input' events — slider drag fires these as real user gestures.
  window.addEventListener('input', (e) => {
    const target = e.target as HTMLElement | null;
    if (target && target.classList?.contains('theater-volume-slider')) {
      applyPendingBoost();
      resumeIfSuspended();
    }
  }, { capture: true, passive: true });

  // CustomEvent listener — adjusts gain.value if AudioContext already exists,
  // otherwise marks the video as pending for setup on next real user gesture.
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

  function readYoutubeSnapshot(): Record<string, unknown> | null {
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

  function readVimeoSnapshot(): Record<string, unknown> | null {
    try {
      const win = window as any;
      const config = win.playerConfig || win._player_config || null;
      if (!config) return null;
      const chapters = Array.isArray(config?.embed?.chapters) ? config.embed.chapters : [];
      const normalizedChapters = chapters.slice(0, 80).map((chapter: any) => ({
        startTime: Number(chapter.startTime ?? chapter.timecode ?? chapter.start),
        title: String(chapter.title || chapter.name || '').slice(0, 120)
      })).filter((chapter: { startTime: number; title: string }) => Number.isFinite(chapter.startTime) && chapter.title);

      const thumb = config?.request?.thumb_preview;
      const thumbUrl = typeof thumb?.url === 'string' ? thumb.url.slice(0, 2000) : '';
      const thumbPreview = thumbUrl
        ? {
            url: thumbUrl,
            width: Number(thumb.width),
            height: Number(thumb.height),
            frameWidth: Number(thumb.frame_width),
            frameHeight: Number(thumb.frame_height),
            columns: Number(thumb.columns),
            frames: Number(thumb.frames)
          }
        : undefined;

      if (normalizedChapters.length === 0 && !thumbPreview) return null;
      const videoIdRaw = config?.video?.id ?? config?.video?.clip_id;
      return {
        videoId: videoIdRaw != null ? String(videoIdRaw).slice(0, 32) : undefined,
        duration: Number(config?.video?.duration || config?.duration || config?.embed?.duration) || undefined,
        chapters: normalizedChapters,
        thumbPreview
      };
    } catch {
      return null;
    }
  }

  function isPatreonHost(hostname = window.location.hostname): boolean {
    const host = hostname.replace(/^www\./, '').toLowerCase();
    return host === 'patreon.com' || host.endsWith('.patreon.com');
  }

  function findMuxPlayer(): any | null {
    const start = document.querySelector('.theater-everywhere-video-active') || document.querySelector('video');
    let node: Node | null = start;
    while (node) {
      if (node instanceof Element && node.localName === 'mux-player') return node;
      node = node instanceof ShadowRoot ? node.host : node.parentNode;
    }
    return document.querySelector('mux-player');
  }

  function readPatreonPostText(): string {
    const nodes = document.querySelectorAll('article, [data-tag="post-content"], [data-tag="post-details"]');
    let best = '';
    for (const el of nodes) {
      const text = (el.textContent || '').replace(/\s+\n/g, '\n').trim();
      if (text.length > best.length) best = text;
    }
    return best.slice(0, 20000);
  }

  function decodeMuxPageText(html: string): string {
    return html
      .replace(/\\u002f/gi, '/')
      .replace(/\\u0026/gi, '&')
      .replace(/\\u003d/gi, '=')
      .replace(/\\\//g, '/');
  }

  function collectMuxPageAssets(html: string): Array<{
    playbackId: string;
    storyboardUrl?: string;
    captions: Array<{ id: string; url: string; language: string; label: string }>;
  }> {
    const text = decodeMuxPageText(html);
    const byId = new Map<string, {
      playbackId: string;
      storyboardUrl?: string;
      captions: Array<{ id: string; url: string; language: string; label: string }>;
    }>();
    const ensure = (id: string) => {
      let asset = byId.get(id);
      if (!asset) {
        asset = { playbackId: id, captions: [] };
        byId.set(id, asset);
      }
      return asset;
    };
    for (const match of text.matchAll(
      /https:\/\/image\.mux\.com\/([A-Za-z0-9_-]+)\/storyboard\.(vtt|json)(\?[^"'\\\s<>]*)?/gi
    )) {
      const asset = ensure(match[1]);
      if (!asset.storyboardUrl || match[2].toLowerCase() === 'vtt') {
        asset.storyboardUrl = match[0].slice(0, 2000);
      }
    }
    for (const match of text.matchAll(
      /https:\/\/stream\.mux\.com\/([A-Za-z0-9_-]+)\/text\/([A-Za-z0-9_-]+)\.vtt(\?[^"'\\\s<>]*)?/gi
    )) {
      const asset = ensure(match[1]);
      const url = match[0].slice(0, 2000);
      if (asset.captions.some((caption) => caption.url === url)) continue;
      asset.captions.push({
        id: `patreon:${match[1]}:${match[2]}`.slice(0, 160),
        url,
        language: '',
        label: 'Captions'
      });
    }
    return [...byId.values()];
  }

  function pickMuxPageAsset(
    assets: ReturnType<typeof collectMuxPageAssets>,
    playbackId?: string
  ) {
    if (playbackId) {
      const match = assets.find((asset) => asset.playbackId === playbackId);
      if (match) return match;
    }
    return assets.find((asset) => asset.storyboardUrl || asset.captions.length > 0) || null;
  }

  function muxCaptionPath(url: string): string | null {
    try {
      const parsed = new URL(url);
      if (parsed.hostname.replace(/^www\./i, '').toLowerCase() !== 'stream.mux.com') return null;
      return /\/[^/]+\/text\/[^/]+\.vtt$/i.test(parsed.pathname) ? parsed.pathname.toLowerCase() : null;
    } catch {
      return null;
    }
  }

  function captionLooksAutoGenerated(label: string): boolean {
    return /auto[- ]generated|\(auto\)/i.test(label);
  }

  function readMuxTextTrackMeta(player: any): Array<{ language: string; label: string; autoGenerated: boolean }> {
    const meta: Array<{ language: string; label: string; autoGenerated: boolean }> = [];
    const lists = [player?.textTracks, player?.media?.textTracks, player?.media?.nativeEl?.textTracks];
    for (const list of lists) {
      if (!list) continue;
      const length = Number(list.length) || 0;
      for (let i = 0; i < length; i++) {
        const track = list[i];
        const kind = String(track?.kind || '');
        if (kind && kind !== 'subtitles' && kind !== 'captions') continue;
        const language = String(track?.language || '').slice(0, 16);
        const label = String(track?.label || '').slice(0, 80);
        if (!language && !label) continue;
        if (meta.some((item) => item.language === language && item.label === label)) continue;
        meta.push({
          language,
          label,
          autoGenerated: captionLooksAutoGenerated(label)
        });
      }
    }
    return meta;
  }

  function readMuxHlsCaptionTracks(player: any): Array<{
    id: string;
    language: string;
    label: string;
    kind: 'captions' | 'subtitles';
    url: string;
    autoGenerated?: boolean;
  }> {
    const hls = player?._hls || player?.media?._hls || player?.media?.nativeEl?._hls;
    const list = Array.isArray(hls?.subtitleTracks) ? hls.subtitleTracks : [];
    const tracks: Array<{
      id: string;
      language: string;
      label: string;
      kind: 'captions' | 'subtitles';
      url: string;
      autoGenerated?: boolean;
    }> = [];
    for (const track of list.slice(0, 12)) {
      const url = typeof track?.url === 'string' ? track.url.slice(0, 2000) : '';
      if (!isAllowedMediaFetchUrl({ provider: 'patreon', kind: 'caption-track', url }, window.location.href)) continue;
      const label = String(track.name || track.label || track.lang || 'Captions').slice(0, 80);
      tracks.push({
        id: `patreon-hls:${String(track.id ?? url).slice(0, 80)}`,
        language: String(track.lang || track.language || '').slice(0, 16),
        label,
        kind: 'subtitles',
        url,
        autoGenerated: captionLooksAutoGenerated(label)
      });
    }
    return tracks;
  }

  function readPatreonSnapshot(): Record<string, unknown> | null {
    try {
      if (!isPatreonHost()) return null;
      const player = findMuxPlayer();
      const playbackIdRaw = player?.playbackId || player?.getAttribute?.('playback-id');
      const playbackId = playbackIdRaw != null ? String(playbackIdRaw).split('?')[0].slice(0, 80) : '';
      const page = pickMuxPageAsset(
        collectMuxPageAssets(document.documentElement?.innerHTML || ''),
        playbackId
      );
      const storyboard = typeof player?.storyboard === 'string' ? player.storyboard
        : typeof player?.storyboardSrc === 'string' ? player.storyboardSrc
        : player?.getAttribute?.('storyboard-src');
      const token = player?.tokens?.storyboard || player?.getAttribute?.('storyboard-token');
      let storyboardUrl = typeof storyboard === 'string' ? storyboard.slice(0, 2000) : '';
      if (!storyboardUrl) storyboardUrl = page?.storyboardUrl || '';
      if (!storyboardUrl && playbackId && /^[A-Za-z0-9_-]+$/.test(playbackId) && token) {
        const url = new URL(`https://image.mux.com/${playbackId}/storyboard.vtt`);
        url.searchParams.set('format', 'webp');
        url.searchParams.set('token', String(token));
        storyboardUrl = url.toString().slice(0, 2000);
      }
      const chapters = Array.isArray(player?.chapters)
        ? player.chapters.slice(0, 80).map((chapter: any) => ({
            startTime: Number(chapter?.startTime ?? chapter?.start),
            title: String(chapter?.value || chapter?.title || '').slice(0, 120)
          })).filter((chapter: { startTime: number; title: string }) => Number.isFinite(chapter.startTime) && chapter.title)
        : [];
      const hlsCaptions = player ? readMuxHlsCaptionTracks(player) : [];
      const captionTracks = [...hlsCaptions];
      for (const caption of page?.captions || []) {
        const path = muxCaptionPath(caption.url);
        if (captionTracks.some((track) => track.url === caption.url || muxCaptionPath(track.url) === path)) continue;
        captionTracks.push({
          id: caption.id,
          language: caption.language,
          label: caption.label,
          kind: captionLooksAutoGenerated(caption.label) ? 'captions' : 'subtitles',
          url: caption.url,
          autoGenerated: captionLooksAutoGenerated(caption.label)
        });
      }
      const textMeta = player ? readMuxTextTrackMeta(player) : [];
      if (captionTracks.length === 1 && textMeta.length > 0) {
        const meta = textMeta[0];
        if (!captionTracks[0].language && meta.language) captionTracks[0].language = meta.language;
        if ((captionTracks[0].label === 'Captions' || !captionTracks[0].label) && meta.label) {
          captionTracks[0].label = meta.label;
        }
        captionTracks[0].autoGenerated = Boolean(
          captionTracks[0].autoGenerated || meta.autoGenerated || captionLooksAutoGenerated(captionTracks[0].label)
        );
      }
      const description = readPatreonPostText();
      if (!storyboardUrl && chapters.length === 0 && captionTracks.length === 0 && !description) return null;
      return {
        playbackId: playbackId || page?.playbackId || undefined,
        duration: Number(player?.duration) || undefined,
        storyboardUrl: storyboardUrl || undefined,
        description: description || undefined,
        chapters,
        captionTracks
      };
    } catch {
      return null;
    }
  }

  function isTwitchHostName(hostname: string): boolean {
    const host = hostname.replace(/^www\./i, '').toLowerCase();
    return host === 'twitch.tv' || host.endsWith('.twitch.tv');
  }

  function twitchPageVideoId(href: string): string | null {
    try {
      const url = new URL(href, 'https://www.twitch.tv');
      if (!isTwitchHostName(url.hostname)) return null;
      const parts = url.pathname.split('/').filter(Boolean);
      const videoIndex = parts.findIndex((part) => part === 'videos' || part === 'video');
      if (videoIndex >= 0 && parts[videoIndex + 1]) {
        const id = parts[videoIndex + 1].replace(/^v/i, '').replace(/[^\d].*$/, '');
        return id || null;
      }
      const queryVideo = url.searchParams.get('video') || url.searchParams.get('vod');
      if (!queryVideo) return null;
      const id = queryVideo.replace(/^v/i, '').replace(/[^\d].*$/, '');
      return id || null;
    } catch {
      return null;
    }
  }

  function isAllowedTwitchStoryboardUrl(url: string): boolean {
    try {
      const parsed = new URL(url, window.location.href);
      if (parsed.protocol !== 'https:') return false;
      const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
      const hostOk = host === 'vod-secure.twitch.tv'
        || host === 'vod-storyboards.twitch.tv'
        || host === 'static-cdn.jtvnw.net'
        || /^d[a-z0-9]{6,}\.cloudfront\.net$/i.test(host);
      return hostOk && /\/storyboards\/[^/?#]*info\.json$/i.test(parsed.pathname);
    } catch {
      return false;
    }
  }

  function canonicalizeTwitchStoryboardUrl(url: string): string | null {
    try {
      const parsed = new URL(url, window.location.href);
      parsed.hash = '';
      if (!isAllowedTwitchStoryboardUrl(parsed.toString())) return null;
      return parsed.toString().slice(0, 2000);
    } catch {
      return null;
    }
  }

  function publishTwitchHarvest(): void {
    const payload = JSON.stringify({
      videoId: twitchHarvest.videoId || '',
      duration: twitchHarvest.duration || '',
      seekPreviewsURL: twitchHarvest.seekPreviewsURL || '',
      moments: twitchHarvest.moments
    });
    let node = document.getElementById('theater-everywhere-twitch-harvest');
    if (!node) {
      node = document.createElement('div');
      node.id = 'theater-everywhere-twitch-harvest';
      node.hidden = true;
      document.documentElement.appendChild(node);
    }
    if (node.textContent !== payload) node.textContent = payload;
  }

  function notifyTwitchHarvest(): void {
    publishTwitchHarvest();
    if (twitchHarvestNotifyTimer) return;
    twitchHarvestNotifyTimer = window.setTimeout(() => {
      twitchHarvestNotifyTimer = 0;
      window.dispatchEvent(new CustomEvent('theater-everywhere-twitch-harvest'));
    }, 80);
  }

  function rememberTwitchStoryboardUrl(url: string): void {
    const canonical = canonicalizeTwitchStoryboardUrl(url);
    if (!canonical) return;
    const videoId = twitchPageVideoId(window.location.href);
    if (videoId && twitchHarvest.videoId && twitchHarvest.videoId !== videoId) {
      twitchHarvest = { videoId, moments: [] };
    }
    const changed = twitchHarvest.seekPreviewsURL !== canonical;
    twitchHarvest.seekPreviewsURL = canonical;
    if (videoId) twitchHarvest.videoId = videoId;
    if (changed) notifyTwitchHarvest();
  }

  function readTwitchMoment(item: Record<string, unknown>): { startTime: number; endTime?: number; title: string } | null {
    const startMs = Number(item.positionMilliseconds);
    const details = item.details && typeof item.details === 'object' ? item.details as Record<string, unknown> : null;
    const game = details?.game && typeof details.game === 'object' ? details.game as Record<string, unknown> : null;
    const title = [
      item.description,
      item.subDescription,
      item.name,
      item.title,
      game?.displayName
    ].find((value) => typeof value === 'string' && String(value).trim());
    if (!Number.isFinite(startMs) || startMs < 0 || typeof title !== 'string' || !title.trim()) return null;
    const durationMs = Number(item.durationMilliseconds);
    return {
      startTime: startMs / 1000,
      endTime: Number.isFinite(durationMs) ? startMs / 1000 + durationMs / 1000 : undefined,
      title: title.trim().slice(0, 120)
    };
  }

  function addTwitchHarvestMoment(moment: { startTime: number; endTime?: number; title: string }): boolean {
    const key = `${moment.startTime}:${moment.title}`;
    if (twitchHarvest.moments.some((entry) => `${entry.startTime}:${entry.title}` === key)) return false;
    twitchHarvest.moments.push(moment);
    twitchHarvest.moments.sort((left, right) => left.startTime - right.startTime);
    return true;
  }

  function harvestTwitchGqlBody(body: string): void {
    if (!body || body.length > MAX_CAPTION_BYTES) return;
    if (!/"seekPreviewsURL"|"positionMilliseconds"|"lengthSeconds"|"moments"/.test(body.slice(0, 200000))) return;
    if (window !== window.top) {
      try {
        window.top!.postMessage({ type: 'theater-everywhere-twitch-harvest-body', body }, '*');
      } catch {
        // Cross-origin parent frames cannot receive harvest copies.
      }
    }
    let data: unknown;
    try {
      data = JSON.parse(body);
    } catch {
      return;
    }
    const videoId = twitchPageVideoId(window.location.href);
    if (videoId && twitchHarvest.videoId && twitchHarvest.videoId !== videoId) {
      twitchHarvest = { videoId, moments: [] };
    }
    if (videoId) twitchHarvest.videoId = videoId;
    let changed = false;
    let budget = 4000;
    const walk = (node: unknown, depth: number) => {
      if (budget <= 0 || node == null || depth > 12) return;
      budget -= 1;
      if (Array.isArray(node)) {
        for (const item of node) walk(item, depth + 1);
        return;
      }
      if (typeof node !== 'object') return;
      const record = node as Record<string, unknown>;
      const id = record.id != null ? String(record.id).replace(/^v/i, '') : '';
      const idMatchesVideo = !videoId || !id || id === videoId;
      if (idMatchesVideo && typeof record.seekPreviewsURL === 'string') {
        const before = twitchHarvest.seekPreviewsURL;
        rememberTwitchStoryboardUrl(record.seekPreviewsURL);
        if (twitchHarvest.seekPreviewsURL !== before) changed = true;
      }
      if (idMatchesVideo) {
        const length = Number(record.lengthSeconds ?? record.length);
        if (Number.isFinite(length) && length > 0) twitchHarvest.duration = length;
      }
      const moment = readTwitchMoment(record);
      if (moment && addTwitchHarvestMoment(moment)) changed = true;
      const momentSource = Array.isArray(record.moments)
        ? record.moments
        : Array.isArray((record.moments as { edges?: unknown[] } | undefined)?.edges)
          ? ((record.moments as { edges: Array<{ node?: Record<string, unknown> }> }).edges
              .map((edge) => edge?.node)
              .filter(Boolean) as Record<string, unknown>[])
          : [];
      for (const entry of momentSource) {
        if (!entry || typeof entry !== 'object') continue;
        const parsed = readTwitchMoment(entry as Record<string, unknown>);
        if (parsed && addTwitchHarvestMoment(parsed)) changed = true;
        if (twitchHarvest.moments.length >= 80) break;
      }
      for (const value of Object.values(record)) walk(value, depth + 1);
    };
    try {
      walk(data, 0);
    } catch {
      // Ignore malformed GraphQL trees.
    }
    publishTwitchHarvest();
    if (changed) notifyTwitchHarvest();
  }

  function readTwitchSnapshot(): Record<string, unknown> | null {
    try {
      if (!isTwitchHostName(window.location.hostname)) return null;
      const videoId = twitchPageVideoId(window.location.href);
      if (!videoId) return { videoId: undefined };
      if (twitchHarvest.videoId && twitchHarvest.videoId !== videoId) {
        twitchHarvest = { videoId, moments: [] };
      }
      const urls: string[] = [];
      const seenUrls = new Set<string>();
      const addUrl = (raw?: string | null) => {
        if (!raw) return;
        const canonical = canonicalizeTwitchStoryboardUrl(raw);
        if (!canonical || seenUrls.has(canonical)) return;
        seenUrls.add(canonical);
        urls.push(canonical);
      };
      addUrl(twitchHarvest.seekPreviewsURL);
      try {
        for (const entry of performance.getEntriesByType('resource')) {
          addUrl((entry as PerformanceResourceTiming).name);
        }
      } catch {
        // performance timeline may be unavailable.
      }
      const seekPreviewsURL = urls.find((url) => url.includes(videoId)) || urls[0];
      return {
        videoId,
        duration: twitchHarvest.duration,
        seekPreviewsURL,
        moments: [...twitchHarvest.moments],
        captionTracks: []
      };
    } catch {
      return null;
    }
  }

  const DISNEY_SNAPSHOT_SCRIPT_ID = 'theater-everywhere-disney-snapshot';
  const DISNEY_DURATION_KEY_RE = /^(runtime(millis|ms)?|duration(millis|ms|inms)?|length(millis|ms)?)$/i;
  const DISNEY_PLAY_ID_RE = /\/play\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

  function isDisneyHostName(hostname: string): boolean {
    const host = hostname.replace(/^www\./i, '').toLowerCase();
    return host === 'disneyplus.com' || host.endsWith('.disneyplus.com');
  }

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

  function isAllowedDisneyBifUrl(url: string): boolean {
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
      if (String((main as { presentationType?: string }).presentationType || '').toUpperCase() === 'MAIN') return meta;
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

  function harvestDisneyBifFromXhr(xhr: XMLHttpRequest): void {
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

  function harvestDisneyData(url: string, data: unknown): void {
    if (!disneyIntegrationEnabled()) return;
    if (!isDisneyHostName(window.location.hostname) && !shouldHarvestDisneyUrl(url)) return;
    const extracted = extractDisneyHarvest(data);
    if (extracted) mergeDisneyHarvest(extracted);
  }

  function harvestDisneyBody(url: string, body: string): void {
    if (!disneyIntegrationEnabled() || !body) return;
    if (body.length > MAX_CAPTION_BYTES) return;
    const trimmed = body.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return;
    if (!shouldHarvestDisneyUrl(url) && !isDisneyHostName(window.location.hostname)) return;
    if (!/runtimeMillis|runtimeMs|"timedText"|timedTextTracks|trickPlay|subtitle|caption|"bifs"|una-ctr-all|"complete"/i.test(trimmed.slice(0, 8000))
      && !shouldHarvestDisneyUrl(url)) return;
    try {
      harvestDisneyData(url, JSON.parse(trimmed));
    } catch {
      // Ignore non-JSON playback bodies.
    }
  }

  function readDisneySnapshot(): Record<string, unknown> | null {
    try {
      if (!isDisneyHostName(window.location.hostname)) return null;
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

  window.addEventListener('theater-everywhere-media-probe', (event: Event) => {
    const requestId = (event as CustomEvent<{ requestId?: number }>).detail?.requestId;
    let youtube: Record<string, unknown> | null = null;
    let vimeo: Record<string, unknown> | null = null;
    let patreon: Record<string, unknown> | null = null;
    let twitch: Record<string, unknown> | null = null;
    let disney: Record<string, unknown> | null = null;
    try {
      youtube = youtubeIntegrationEnabled() ? readYoutubeSnapshot() : null;
    } catch {
      youtube = null;
    }
    try {
      vimeo = vimeoIntegrationEnabled() ? readVimeoSnapshot() : null;
    } catch {
      vimeo = null;
    }
    try {
      patreon = patreonIntegrationEnabled() ? readPatreonSnapshot() : null;
    } catch {
      patreon = null;
    }
    try {
      twitch = twitchIntegrationEnabled() ? readTwitchSnapshot() : null;
    } catch {
      twitch = null;
    }
    try {
      disney = disneyIntegrationEnabled() ? readDisneySnapshot() : null;
    } catch {
      disney = null;
    }
    publishYoutubeSnapshot(youtube);
    window.dispatchEvent(new CustomEvent('theater-everywhere-media-probe-result', {
      detail: { requestId, youtube, vimeo, patreon, twitch, disney }
    }));
  });

  ['yt-navigate-finish', 'yt-page-data-updated', 'yt-player-updated'].forEach((name) => {
    window.addEventListener(name, publishCurrentYoutubeSnapshot);
    document.addEventListener(name, publishCurrentYoutubeSnapshot);
  });
  [0, 300, 1000, 2500].forEach((ms) => {
    window.setTimeout(publishCurrentYoutubeSnapshot, ms);
  });

  function isAllowedTimedtextUrl(url: string): boolean {
    return isAllowedMediaFetchUrl({ provider: 'youtube', kind: 'caption-track', url }, window.location.href);
  }

  function pageFetchAllowed(url: string): boolean {
    if (!isAllowlistedPageFetchUrl(url, window.location.href)) return false;
    const classified = classifyMediaFetchUrl(url, window.location.href);
    if (!classified) return false;
    if (classified.provider === 'youtube') return youtubeIntegrationEnabled();
    if (classified.provider === 'patreon') return patreonIntegrationEnabled();
    if (classified.provider === 'twitch') return twitchIntegrationEnabled();
    if (classified.provider === 'disney') return disneyIntegrationEnabled();
    return false;
  }

  function respondPageFetch(
    requestId: string,
    nonce: string,
    origin: string,
    okFlag: boolean,
    body?: string
  ): void {
    window.postMessage(
      createWorldMessage('PAGE_FETCH_RESULT', { ok: okFlag, body }, requestId, nonce, origin),
      '*'
    );
  }

  function handlePageFetch(requestId: string, url: string, nonce: string, origin: string): void {
    const respond = (okFlag: boolean, body?: string) => respondPageFetch(requestId, nonce, origin, okFlag, body);
    try {
      if (!pageFetchAllowed(url)) {
        respond(false);
        return;
      }
      const load = isAllowedTimedtextUrl(url)
        ? fetchTimedtextWithPot(url)
        : fetch(url, { credentials: 'omit' }).then(async (response) => {
            if (!response.ok) return null;
            const buffer = await response.arrayBuffer();
            const isBif = isAllowedDisneyBifUrl(url);
            const maxBytes = isBif ? MAX_BIF_BYTES : MAX_CAPTION_BYTES;
            if (buffer.byteLength === 0 || buffer.byteLength > maxBytes) return null;
            if (isBif) return URL.createObjectURL(new Blob([buffer], { type: 'application/octet-stream' }));
            return new TextDecoder().decode(buffer);
          });
      load
        .then((text) => respond(Boolean(text), text || undefined))
        .catch(() => respond(false));
    } catch {
      respond(false);
    }
  }

  window.addEventListener('message', (event: MessageEvent) => {
    if (!isSameWindowMessage(event)) return;
    const envelope = readWorldEnvelope(event.data);
    if (!envelope || envelope.type !== 'PAGE_FETCH') return;
    if (envelope.origin !== 'legacy' && envelope.origin !== event.origin) return;
    const url = envelope.payload.url;
    if (typeof url !== 'string') return;
    handlePageFetch(envelope.requestId, url, envelope.nonce, envelope.origin);
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

  window.addEventListener('theater-everywhere-host-layout-refresh', () => {
    refreshYoutubePlayerLayout();
  });

  function youtubeWallNow(player: any): number | null {
    const now = Number(player?.querySelector?.('.ytp-progress-bar')?.getAttribute('aria-valuenow'));
    return Number.isFinite(now) ? now : null;
  }

  function youtubeWallLiveHead(player: any): number | null {
    const max = Number(player?.querySelector?.('.ytp-progress-bar')?.getAttribute('aria-valuemax'));
    return Number.isFinite(max) ? max : null;
  }

  type DisneyHivePlayer = {
    seek: (ms: number) => unknown;
    play?: () => unknown;
    pause?: () => unknown;
    scrub?: (ms: number) => unknown;
    on?: (name: string, handler: () => void) => unknown;
    timeline?: { info?: { playheadPositionMs?: number } };
  };

  const DISNEY_CLOCK_EVENT = 'theater-everywhere-disney-clock';
  const DISNEY_MEDIA_SEEK_STUCK_SECONDS = 15;
  const DISNEY_SEEK_RETRY_MS = 1500;
  let cachedDisneyPlayer: DisneyHivePlayer | null = null;
  let cachedDisneyPlayerHost: Element | null = null;
  const disneyClockBoundPlayers = new WeakSet<object>();
  let disneyClockTimer = 0;
  let restoreDisneyPauseAfterSeek = false;
  let pendingDisneySeekTarget: number | null = null;

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
    if (/\bhive-video\b/.test(className) || /\btheater-everywhere-video-active\b/.test(className)) {
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
      if (node.classList.contains('theater-everywhere-video-active')) push(node);
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

  function applyDisneyHostSeek(
    player: DisneyHivePlayer,
    timeSeconds: number,
    options: { playIfIdle?: boolean; scrub?: boolean }
  ): void {
    const ms = Math.round(timeSeconds * 1000);
    player.seek(ms);
    if (options.playIfIdle) {
      if (disneySessionLooksPaused()) {
        restoreDisneyPauseAfterSeek = true;
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
    window.dispatchEvent(new CustomEvent(DISNEY_CLOCK_EVENT, { detail: { time: seconds } }));
    return seconds;
  }

  function bindDisneyPlayerClock(player: DisneyHivePlayer | null): void {
    if (!player || typeof player.on !== 'function') return;
    if (disneyClockBoundPlayers.has(player)) return;
    const publish = () => {
      publishDisneyPlayhead(disneyActiveMediaVideo(), player);
      if (pendingDisneySeekTarget == null || !disneyHiveSeekReached(player, pendingDisneySeekTarget)) return;
      if (restoreDisneyPauseAfterSeek) {
        try {
          player.pause?.();
        } catch {
          // Ignore pause races after seek.
        }
        restoreDisneyPauseAfterSeek = false;
      }
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
    if (!isDisneyHostName(window.location.hostname) || !disneyIntegrationEnabled()) return;
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

  window.addEventListener('theater-everywhere-disney-harvest', () => {
    ensureDisneyClock();
  });
  if (isDisneyHostName(window.location.hostname)) {
    ensureDisneyClock();
  }

  window.addEventListener('theater-everywhere-media-seek', (event: Event) => {
    const detail = (event as CustomEvent<{ live?: boolean; time?: number }>).detail || {};
    const player = findYoutubePlayer();
    const video = findActiveVideo(document) || document.querySelector('video');
    if (
      isDisneyHostName(window.location.hostname)
      && disneyIntegrationEnabled()
      && typeof detail.time === 'number'
      && Number.isFinite(detail.time)
    ) {
      const mediaVideo = disneyActiveMediaVideo()
        || (video instanceof HTMLVideoElement && isUsableDisneyMediaVideo(video) ? video : null);
      const hive = findDisneyHivePlayer(mediaVideo, true);
      if (hive) {
        // Do not write teDisneyPlayhead to the target here. Captions and the
        // clock follow timeline.info / MEDIA_SEEK_COMPLETE; the scrubber thumb
        // uses pendingMediaSeeks until the host playhead moves.
        pendingDisneySeekTarget = detail.time;
        restoreDisneyPauseAfterSeek = disneySessionLooksPaused();
        try {
          applyDisneyHostSeek(hive, detail.time, { playIfIdle: false, scrub: false });
          bindDisneyPlayerClock(hive);
        } catch {
          // Player seek can throw if the session is still attaching.
        }
        window.setTimeout(() => {
          if (pendingDisneySeekTarget == null) return;
          const latestVideo = disneyActiveMediaVideo();
          const latestHive = findDisneyHivePlayer(latestVideo, true);
          if (!latestHive || disneyHiveSeekReached(latestHive, pendingDisneySeekTarget)) return;
          if (!disneyMediaSeekLooksStuck(latestVideo, pendingDisneySeekTarget)) return;
          try {
            applyDisneyHostSeek(latestHive, pendingDisneySeekTarget, { playIfIdle: true, scrub: true });
            bindDisneyPlayerClock(latestHive);
          } catch {
            // Retry can fail if the session dropped.
          }
        }, DISNEY_SEEK_RETRY_MS);
      }
      return;
    }
    try {
      if (detail.live === true) {
        const liveHead = youtubeWallLiveHead(player);
        if (typeof player?.seekTo === 'function' && liveHead != null) {
          player.seekTo(liveHead, true);
        }
        if (typeof player?.seekToLiveHead === 'function') {
          player.seekToLiveHead();
        }
        return;
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
          return;
        }
      }
    } catch {
      // Watch-page player may not expose live seek helpers.
    }
    if (video instanceof HTMLVideoElement && typeof detail.time === 'number' && Number.isFinite(detail.time)) {
      video.currentTime = detail.time;
    }
  });

  window.addEventListener('theater-everywhere-boost-event', () => {
    const video = findActiveVideo(document);
    if (!video) return;

    const multiplier = parseFloat(video.dataset.theaterBoost || '1.0');
    const boosted = video as any;

    if (boosted._theaterGainNode) {
      // AudioContext already running — just adjust gain
      boosted._theaterGainNode.gain.value = multiplier;
      video.dataset.theaterBoostReady = 'true';

      if (boosted._theaterAudioCtx && boosted._theaterAudioCtx.state === 'suspended') {
        boosted._theaterAudioCtx.resume().catch(() => {});
      }
    } else if (multiplier > 1.0 && !failedVideos.has(video)) {
      // Boost requested but AudioContext not yet created.
      pendingVideo = video;
      pendingMultiplier = multiplier;
    }
  });
})();
