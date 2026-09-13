import { createTimedtextCacheRecord, findCachedTimedtextBody, timedtextVideoId, youtubePageVideoId, type CachedTimedtext } from './media-features/youtube-caption-url';

(function() {
  const MAX_CAPTION_BYTES = 2 * 1024 * 1024;
  const timedtextBodies: CachedTimedtext[] = [];
  let twitchHarvest: {
    videoId?: string;
    duration?: number;
    seekPreviewsURL?: string;
    moments: Array<{ startTime: number; endTime?: number; title: string }>;
  } = { moments: [] };
  let twitchHarvestNotifyTimer = 0;

  function youtubeIntegrationEnabled(): boolean {
    return !document.documentElement.hasAttribute('data-te-youtube-integration-off');
  }

  function vimeoIntegrationEnabled(): boolean {
    return !document.documentElement.hasAttribute('data-te-vimeo-integration-off');
  }

  function twitchIntegrationEnabled(): boolean {
    return !document.documentElement.hasAttribute('data-te-twitch-integration-off');
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

  function wrapFetch(fn: typeof fetch): typeof fetch {
    return function(this: Window, input: RequestInfo | URL): Promise<Response> {
      const url = requestUrl(input);
      return Promise.resolve(fn.apply(this, arguments as unknown as [RequestInfo | URL, RequestInit?])).then((response) => {
        try {
          const clone = response.clone();
          captureTimedtextResponse(url, clone);
          captureTwitchNetworkResponse(url, clone);
        } catch {
          // Harvest must not break the page's fetch.
        }
        return response;
      });
    } as typeof fetch;
  }

  const originalResponseJson = Response.prototype.json;
  Response.prototype.json = function(this: Response) {
    const result = originalResponseJson.apply(this, arguments as unknown as []);
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      (result as Promise<unknown>).then((data) => {
        try {
          if (!twitchIntegrationEnabled()) return;
          const url = this.url || '';
          if (!/gql\.twitch\.tv/i.test(url)) return;
          harvestTwitchGqlBody(JSON.stringify(data));
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
          if (!twitchIntegrationEnabled() || !text) return;
          const url = this.url || '';
          if (!/gql\.twitch\.tv/i.test(url) && !/"positionMilliseconds"|"seekPreviewsURL"/.test(text.slice(0, 4000))) return;
          if (!isTwitchHostName(window.location.hostname) && !/gql\.twitch\.tv/i.test(url)) return;
          harvestTwitchGqlBody(text);
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
      const body = xhrResponseText(this);
      if (body) cacheTimedtextBody(url, body);
      if (body && /gql\.twitch\.tv/i.test(url)) harvestTwitchGqlBody(body);
      if (isAllowedTwitchStoryboardUrl(url)) rememberTwitchStoryboardUrl(url);
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

  function findYoutubePlayer(): any {
    return document.querySelector('#movie_player, .html5-video-player');
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
    const videoId = timedtextVideoId(url);
    for (const entry of timedtextUrlsFromPerformance().reverse()) {
      if (!videoId || timedtextVideoId(entry) === videoId) add(entry);
    }
    add(url);
    try {
      const parsed = new URL(url, window.location.href);
      parsed.searchParams.set('fmt', 'json3');
      add(parsed.toString());
    } catch {
      // Keep the original caption URL.
    }
    const snapshot = readYoutubeSnapshot() as { captionTracks?: Array<{ baseUrl?: string }> } | null;
    for (const track of snapshot?.captionTracks || []) {
      if (!track.baseUrl) continue;
      add(track.baseUrl);
      try {
        const parsed = new URL(track.baseUrl, window.location.href);
        parsed.searchParams.set('fmt', 'json3');
        add(parsed.toString());
      } catch {
        // Ignore malformed player-response caption URLs.
      }
    }
    for (const candidate of candidates.slice(0, 8)) {
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
    if (boosted._theaterGainNode) return true; // Already initialized
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
      if (!isAllowedMuxCaptionUrl(url)) continue;
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
        captionTracks.push(caption);
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

  function isAllowedTwitchCaptionUrl(url: string): boolean {
    try {
      const parsed = new URL(url, window.location.href);
      if (parsed.protocol !== 'https:') return false;
      const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
      if (host !== 'captions.twitch.tv' && !host.endsWith('.captions.twitch.tv')) return false;
      return /\.vtt$/i.test(parsed.pathname);
    } catch {
      return false;
    }
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

  window.addEventListener('theater-everywhere-media-probe', (event: Event) => {
    const requestId = (event as CustomEvent<{ requestId?: number }>).detail?.requestId;
    window.dispatchEvent(new CustomEvent('theater-everywhere-media-probe-result', {
      detail: {
        requestId,
        youtube: youtubeIntegrationEnabled() ? readYoutubeSnapshot() : null,
        vimeo: vimeoIntegrationEnabled() ? readVimeoSnapshot() : null,
        patreon: patreonIntegrationEnabled() ? readPatreonSnapshot() : null,
        twitch: twitchIntegrationEnabled() ? readTwitchSnapshot() : null
      }
    }));
  });

  function isAllowedMuxStoryboardUrl(url: string): boolean {
    try {
      const parsed = new URL(url, window.location.href);
      if (parsed.protocol !== 'https:') return false;
      const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
      if (host !== 'image.mux.com') return false;
      return /\/[^/]+\/storyboard\.(vtt|json)$/i.test(parsed.pathname);
    } catch {
      return false;
    }
  }

  function isAllowedMuxCaptionUrl(url: string): boolean {
    try {
      const parsed = new URL(url, window.location.href);
      if (parsed.protocol !== 'https:') return false;
      const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
      if (host !== 'stream.mux.com') return false;
      return /\/[^/]+\/text\/[^/]+\.vtt$/i.test(parsed.pathname);
    } catch {
      return false;
    }
  }

  function isAllowedTimedtextUrl(url: string): boolean {
    try {
      const parsed = new URL(url, window.location.href);
      if (parsed.protocol !== 'https:') return false;
      const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
      const hostOk = host === 'youtube.com'
        || host === 'youtu.be'
        || host === 'youtube-nocookie.com'
        || host.endsWith('.youtube.com');
      return hostOk && /timedtext/i.test(parsed.pathname);
    } catch {
      return false;
    }
  }

  function isAllowedPageFetchUrl(url: string): boolean {
    if (youtubeIntegrationEnabled() && isAllowedTimedtextUrl(url)) return true;
    if (patreonIntegrationEnabled() && (isAllowedMuxStoryboardUrl(url) || isAllowedMuxCaptionUrl(url))) return true;
    if (twitchIntegrationEnabled() && isAllowedTwitchCaptionUrl(url)) return true;
    return false;
  }

  function processPendingCaptionFetches(): void {
    const jobs = document.querySelectorAll<HTMLElement>('[data-te-caption-fetch="pending"]');
    for (const job of jobs) {
      const requestId = Number(job.dataset.teCaptionId || 0);
      const url = String(job.dataset.teCaptionUrl || '');
      job.dataset.teCaptionFetch = 'running';
      const respond = (ok: boolean, body?: string) => {
        if (ok && body) job.textContent = body;
        job.dataset.teCaptionFetch = ok && body ? 'ok' : 'err';
        window.dispatchEvent(new CustomEvent('theater-everywhere-media-fetch-result', {
          detail: { requestId, ok: Boolean(ok && body) }
        }));
      };
      try {
        if (!isAllowedPageFetchUrl(url)) {
          respond(false);
          continue;
        }
        const load = isAllowedTimedtextUrl(url)
          ? fetchTimedtextWithPot(url)
          : fetch(url, { credentials: 'omit' }).then(async (response) => {
              if (!response.ok) return null;
              const buffer = await response.arrayBuffer();
              if (buffer.byteLength === 0 || buffer.byteLength > MAX_CAPTION_BYTES) return null;
              return new TextDecoder().decode(buffer);
            });
        load
          .then((text) => respond(Boolean(text), text || undefined))
          .catch(() => respond(false));
      } catch {
        respond(false);
      }
    }
  }

  new MutationObserver(processPendingCaptionFetches).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-te-caption-fetch']
  });
  window.addEventListener('theater-everywhere-media-fetch', () => {
    processPendingCaptionFetches();
  });
  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window) return;
    if (event.data && event.data.type === 'theater-everywhere-media-fetch') {
      processPendingCaptionFetches();
    }
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

  window.addEventListener('theater-everywhere-boost-event', () => {
    const video = findActiveVideo(document);
    if (!video) return;

    const multiplier = parseFloat(video.dataset.theaterBoost || '1.0');
    const boosted = video as any;

    if (boosted._theaterGainNode) {
      // AudioContext already running — just adjust gain
      boosted._theaterGainNode.gain.value = multiplier;

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
