import { createTimedtextCacheRecord, findCachedTimedtextBody, timedtextVideoId, youtubePageVideoId, type CachedTimedtext } from './media-features/youtube-caption-url';

(function() {
  const MAX_CAPTION_BYTES = 2 * 1024 * 1024;
  const timedtextBodies: CachedTimedtext[] = [];

  function youtubeIntegrationEnabled(): boolean {
    return !document.documentElement.hasAttribute('data-te-youtube-integration-off');
  }

  function vimeoIntegrationEnabled(): boolean {
    return !document.documentElement.hasAttribute('data-te-vimeo-integration-off');
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

  function wrapFetch(fn: typeof fetch): typeof fetch {
    return function(this: Window, input: RequestInfo | URL): Promise<Response> {
      const url = requestUrl(input);
      const result = fn.apply(this, arguments as unknown as [RequestInfo | URL, RequestInit?]);
      if (result && typeof (result as Promise<Response>).then === 'function') {
        (result as Promise<Response>).then((response) => captureTimedtextResponse(url, response)).catch(() => {});
      }
      return result;
    } as typeof fetch;
  }

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
    this.addEventListener('load', function(this: XMLHttpRequest) {
      const url = this.responseURL || (this as XMLHttpRequest & { _theaterTimedtextUrl?: string })._theaterTimedtextUrl || '';
      if (this.status < 200 || this.status >= 300) return;
      const body = xhrResponseText(this);
      if (body) cacheTimedtextBody(url, body);
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

  window.addEventListener('theater-everywhere-media-probe', (event: Event) => {
    const requestId = (event as CustomEvent<{ requestId?: number }>).detail?.requestId;
    window.dispatchEvent(new CustomEvent('theater-everywhere-media-probe-result', {
      detail: {
        requestId,
        youtube: youtubeIntegrationEnabled() ? readYoutubeSnapshot() : null,
        vimeo: vimeoIntegrationEnabled() ? readVimeoSnapshot() : null
      }
    }));
  });

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
      if (!youtubeIntegrationEnabled() || !isAllowedTimedtextUrl(url)) {
        respond(false);
        continue;
      }
      fetchTimedtextWithPot(url)
        .then((text) => respond(Boolean(text), text || undefined))
        .catch(() => respond(false));
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
