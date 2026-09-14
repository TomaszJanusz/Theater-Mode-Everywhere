import { classifyMediaFetchUrl, isAllowedPageFetchUrl as isAllowlistedPageFetchUrl, MAX_CAPTION_BYTES } from '../media-features/fetch-allowlist';
import { createWorldMessage, isSameWindowMessage, readWorldEnvelope } from '../protocol/world-messages';
import { markFetchPatched } from '../providers/registry';
import { findActiveVideo } from './active-video';
import {
  captureTimedtextResponse,
  cacheTimedtextBody,
  fetchTimedtextWithPot,
  handleYoutubeMediaSeek,
  installYoutubeMain,
  isAllowedTimedtextUrl,
  publishYoutubeProbeSnapshot,
  readYoutubeSnapshot,
  youtubeIntegrationEnabled
} from '../providers/youtube/main';
import { readVimeoSnapshot, vimeoIntegrationEnabled } from '../providers/vimeo/main';
import { patreonIntegrationEnabled, readPatreonSnapshot } from '../providers/patreon/main';
import {
  captureTwitchNetworkResponse,
  harvestTwitchResponseJson,
  harvestTwitchResponseText,
  harvestTwitchXhr,
  installTwitchMain,
  readTwitchSnapshot,
  twitchIntegrationEnabled
} from '../providers/twitch/main';
import {
  captureDisneyNetworkResponse,
  disneyIntegrationEnabled,
  handleDisneyMediaSeek,
  harvestDisneyBifFromXhr,
  harvestDisneyBody,
  harvestDisneyData,
  installDisneyMain,
  isAllowedDisneyBifUrl,
  MAX_BIF_BYTES,
  readDisneySnapshot
} from '../providers/disney/main';

export function installMainWorldRuntime(): void {
  const FETCH_WRAPPED = Symbol.for('theater-everywhere.wrapped-fetch');

  function requestUrl(input: RequestInfo | URL): string {
    if (typeof input === 'string') return input;
    if (input instanceof URL) return input.toString();
    if (input && typeof input === 'object' && 'url' in input) return String((input as Request).url);
    return '';
  }

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
            harvestTwitchResponseJson(url, data);
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
            harvestTwitchResponseText(url, text);
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
        harvestTwitchXhr(url, body, this);
        if (body) harvestDisneyBody(url, body);
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

  installYoutubeMain();
  installTwitchMain();
  installDisneyMain();

  let pendingVideo: HTMLVideoElement | null = null;
  let pendingMultiplier: number = 1.0;
  const failedVideos = new WeakSet<HTMLVideoElement>();

  function setupAudioGraph(video: HTMLVideoElement): boolean {
    const boosted = video as any;
    if (boosted._theaterGainNode) {
      video.dataset.theaterBoostReady = 'true';
      return true;
    }
    if (failedVideos.has(video)) return false;

    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return false;

      const ctx = new AudioCtx();
      const source = ctx.createMediaElementSource(video);
      const gain = ctx.createGain();

      source.connect(gain);
      gain.connect(ctx.destination);

      boosted._theaterAudioCtx = ctx;
      boosted._theaterGainNode = gain;
      video.dataset.theaterBoostReady = 'true';
      window.dispatchEvent(new CustomEvent('theater-everywhere-boost-ready'));

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

  window.addEventListener('input', (e) => {
    const target = e.target as HTMLElement | null;
    if (target && target.classList?.contains('theater-volume-slider')) {
      applyPendingBoost();
      resumeIfSuspended();
    }
  }, { capture: true, passive: true });

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
    publishYoutubeProbeSnapshot(youtube);
    window.dispatchEvent(new CustomEvent('theater-everywhere-media-probe-result', {
      detail: { requestId, youtube, vimeo, patreon, twitch, disney }
    }));
  });

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
    if (envelope.origin !== event.origin) return;
    const url = envelope.payload.url;
    if (typeof url !== 'string') return;
    handlePageFetch(envelope.requestId, url, envelope.nonce, envelope.origin);
  });

  window.addEventListener('theater-everywhere-media-seek', (event: Event) => {
    const detail = (event as CustomEvent<{ live?: boolean; time?: number }>).detail || {};
    const video = findActiveVideo(document) || document.querySelector('video');
    if (handleDisneyMediaSeek(detail, video)) return;
    if (handleYoutubeMediaSeek(detail, video)) return;
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
      boosted._theaterGainNode.gain.value = multiplier;
      video.dataset.theaterBoostReady = 'true';

      if (boosted._theaterAudioCtx && boosted._theaterAudioCtx.state === 'suspended') {
        boosted._theaterAudioCtx.resume().catch(() => {});
      }
    } else if (multiplier > 1.0 && !failedVideos.has(video)) {
      pendingVideo = video;
      pendingMultiplier = multiplier;
    }
  });
}
