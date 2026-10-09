import { installXhrHarvest } from './xhr-harvest';
import { assertSafeRedirect, classifyMediaFetchUrl, isAllowedPageFetchUrl as isAllowlistedPageFetchUrl, MAX_CAPTION_BYTES } from './media-url-policy';
import { createWorldMessage, isSameWindowMessage, readWorldEnvelope } from '../protocol/world-messages';
import { markFetchPatched, shouldPatchMainWorld } from '../providers/registry';
import { findActiveVideo } from './active-video';
import { queryPlayerUi } from '../ui/root';
import { isHostPlayControlLabel, mainWorldOwnsWasmPlayPause, toggleDirectPlayback } from '../host-play';
import { HOST_PLAY_CONTROL_SELECTOR } from '../providers/play-controls';
import { isTencentWasmPlayerElement } from '../providers/tencent/wasm-player';
import { matchesShortcut } from '../ui/shortcuts';
import { ENTRY_SHORTCUT_ATTRIBUTE, ENTRY_SHORTCUT_EVENT } from '../ui/entry-shortcuts';
import { isChatDocument, isNativeChatEvent } from '../chat';
import { isTwitchHost } from '../providers/hosts';
import {
  captureTimedtextResponse,
  cacheTimedtextBody,
  fetchTimedtextWithPot,
  handleYoutubeMediaSeek,
  harvestYoutubeHeatmapJson,
  harvestYoutubeHeatmapText,
  installYoutubeMain,
  isAllowedTimedtextUrl,
  publishYoutubeProbeSnapshot,
  readYoutubeSnapshot,
  youtubeIntegrationEnabled
} from '../providers/youtube/main';
import { readVimeoSnapshot, vimeoIntegrationEnabled } from '../providers/vimeo/main';
import { readBilibiliSnapshot, bilibiliIntegrationEnabled } from '../providers/bilibili/main';
import { readBilibiliIntlSnapshot, bilibiliIntlIntegrationEnabled } from '../providers/bilibili-intl/main';
import { captureTencentNetworkResponse, harvestTencentBody, harvestTencentData, installTencentMain, isTencentMetadataUrl, readTencentSnapshot, tencentIntegrationEnabled } from '../providers/tencent/main';
import { captureCrunchyrollNetworkResponse, consumeCrunchyrollWrappedFetch, crunchyrollAllowsCaptionFetch, harvestCrunchyrollBody, harvestCrunchyrollData, installCrunchyrollMain, isCrunchyrollBifUrl, noteCrunchyrollManifest, readCrunchyrollSnapshot, rememberCrunchyrollBif } from '../providers/crunchyroll/main';
import { patreonIntegrationEnabled, readPatreonSnapshot } from '../providers/patreon/main';
import {
  captureTwitchNetworkResponse,
  harvestTwitchResponseJson,
  harvestTwitchResponseText,
  harvestTwitchXhr,
  installTwitchMain,
  isAllowedTwitchStoryboardUrl,
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
import {
  installNetflixMain,
  handleNetflixMediaSeek,
  netflixIntegrationEnabled,
  readNetflixSnapshot
} from '../providers/netflix/main';

export function installMainWorldRuntime(): void {
  if (isChatDocument(window.location.href)) return;
  const FETCH_WRAPPED = Symbol.for('theater-everywhere.wrapped-fetch');

  function requestUrl(input: RequestInfo | URL): string {
    if (typeof input === 'string') return input;
    if (input instanceof URL) return input.toString();
    if (input && typeof input === 'object' && 'url' in input) return String((input as Request).url);
    return '';
  }

  function foreignProviderHarvestUrl(url: string): boolean {
    if (!url) return false;
    if (/timedtext/i.test(url)) return true;
    if (/gql\.twitch\.tv/i.test(url)) return true;
    try {
      if (isAllowedTwitchStoryboardUrl(url) || isAllowedDisneyBifUrl(url)) return true;
    } catch {
      // URL checks must not break fetch.
    }
    if (isTencentMetadataUrl(url)) return true;
    if (/\.(m3u8|mp4|m4s|ts|cmfa|cmfv|m4t|jpe?g|png|webp|gif|vtt|bif|js|css|woff2?)(\?|$)/i.test(url)) return false;
    if (/bamgrid\.com|disney-plus\.net/i.test(url)) return true;
    if (/dssott\.com/i.test(url) && /\.json(\?|$)/i.test(url)) return true;
    return /disneyplus\.com/i.test(url) && /\/(playback|session|explore|api)\//i.test(url);
  }

  function wrapFetch(fn: typeof fetch): typeof fetch {
    const tagged = fn as typeof fetch & { [FETCH_WRAPPED]?: boolean };
    if (tagged[FETCH_WRAPPED]) return fn;
    const wrapped = function(this: Window, input: RequestInfo | URL): Promise<Response> {
      const url = requestUrl(input);
      return Promise.resolve(fn.apply(this, arguments as unknown as [RequestInfo | URL, RequestInit?])).then((response) => {
        try {
          if (consumeCrunchyrollWrappedFetch(url, response, foreignProviderHarvestUrl) === 'foreign') {
            const clone = response.clone();
            captureTimedtextResponse(url, clone);
            captureTwitchNetworkResponse(url, clone);
            captureDisneyNetworkResponse(url, clone);
            captureTencentNetworkResponse(url, clone);
            captureCrunchyrollNetworkResponse(url, clone);
          }
        } catch {
          // Harvest must not break the page's fetch.
        }
        return response;
      });
    } as typeof fetch & { [FETCH_WRAPPED]?: boolean };
    wrapped[FETCH_WRAPPED] = true;
    return wrapped;
  }

  const harvestHost = shouldPatchMainWorld(window.location.hostname);
  if (harvestHost && markFetchPatched(window)) {
    const originalResponseJson = Response.prototype.json;
    Response.prototype.json = function(this: Response) {
      const result = originalResponseJson.apply(this, arguments as unknown as []);
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        (result as Promise<unknown>).then((data) => {
          try {
            const url = this.url || '';
            harvestTwitchResponseJson(url, data);
            harvestDisneyData(url, data);
            harvestTencentData(url, data);
            harvestCrunchyrollData(url, data);
            harvestYoutubeHeatmapJson(url, data);
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
            harvestTencentBody(url, text);
            harvestCrunchyrollBody(url, text);
            harvestYoutubeHeatmapText(url, text);
          } catch {
            // Ignore harvest failures from host text parsing.
          }
        }).catch(() => {});
      }
      return result;
    };

    // Twitch replaces fetch with its own transport. Wrapping that replacement
    // freezes native VOD replay after seeking, even outside theater mode.
    // Response JSON/text observers and XHR still harvest Twitch metadata.
    if (!isTwitchHost(window.location.hostname)) {
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
    }

    installXhrHarvest(XMLHttpRequest.prototype, (xhr, url) => {
      if (disneyIntegrationEnabled() && isAllowedDisneyBifUrl(url)) harvestDisneyBifFromXhr(xhr);
      const body = isAllowedDisneyBifUrl(url) ? null : xhrResponseText(xhr);
      if (body) cacheTimedtextBody(url, body);
      harvestTwitchXhr(url, body, xhr);
      if (body) harvestDisneyBody(url, body);
      noteCrunchyrollManifest(url);
      if (body) harvestTencentBody(url, body);
      if (body) harvestCrunchyrollBody(url, body);
      if (xhr.responseType === 'json') harvestTencentData(url, xhr.response);
      if (xhr.responseType === 'json') harvestCrunchyrollData(url, xhr.response);
      if (xhr.response instanceof ArrayBuffer && isCrunchyrollBifUrl(url)) rememberCrunchyrollBif(xhr.response, url);
      if (body) harvestYoutubeHeatmapText(url, body);
    });

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

  if (harvestHost) {
    installYoutubeMain();
    installTwitchMain();
    installDisneyMain();
    installNetflixMain();
    installTencentMain();
    installCrunchyrollMain();
  }

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
    if (!document.documentElement.classList.contains('theater-everywhere-html-active')) return;
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

  // Installed at document_start, before page handlers. The content world remains the command owner.
  const claimedEntryKeys = new Set<string>();
  function captureEntryShortcut(event: KeyboardEvent): void {
    if (isChatDocument(window.location.href) || isNativeChatEvent(event)) return;
    const identity = event.code || event.key;
    if (event.type !== 'keydown') {
      if (!claimedEntryKeys.has(identity)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.type === 'keyup') claimedEntryKeys.delete(identity);
      return;
    }
    if (event.isComposing || event.composedPath().some(isEditableKeyboardTarget)
        || document.querySelector('.te-dialog-overlay') || queryPlayerUi('.te-dialog-overlay')) return;
    let config: { toggle?: unknown; fullscreen?: unknown };
    try { config = JSON.parse(document.documentElement.getAttribute(ENTRY_SHORTCUT_ATTRIBUTE) || '{}'); }
    catch { return; }
    if (!config || !(typeof config.toggle === 'string' && matchesShortcut(event, config.toggle))
        && !(typeof config.fullscreen === 'string' && matchesShortcut(event, config.fullscreen))) return;
    const relay = new CustomEvent(ENTRY_SHORTCUT_EVENT, { cancelable: true, detail: JSON.stringify({
      key: event.key, code: event.code, ctrlKey: event.ctrlKey, altKey: event.altKey,
      shiftKey: event.shiftKey, metaKey: event.metaKey, repeat: event.repeat
    }) });
    window.dispatchEvent(relay);
    if (!relay.defaultPrevented) return;
    claimedEntryKeys.add(identity);
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  for (const type of ['keydown', 'keyup', 'keypress'] as const) window.addEventListener(type, captureEntryShortcut, true);
  window.addEventListener('blur', () => claimedEntryKeys.clear());

  function looksLikeHostPlayButton(el: HTMLElement): boolean {
    if (el.id === 'theater-everywhere-ui' || el.closest('#theater-everywhere-ui')) return false;
    return isHostPlayControlLabel(el.getAttribute('aria-label') || '', el.textContent || '', el.className.toString());
  }

  function findHostPlayButton(video: HTMLVideoElement): HTMLElement | null {
    const scan = (root: ParentNode): HTMLElement | null => {
      const candidates = root.querySelectorAll(HOST_PLAY_CONTROL_SELECTOR);
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

  function publishedShortcut(name: string): string | null {
    try {
      const config = JSON.parse(document.documentElement.getAttribute(ENTRY_SHORTCUT_ATTRIBUTE) || '{}') as Record<string, unknown>;
      const value = config[name];
      return typeof value === 'string' ? value : null;
    } catch {
      return null;
    }
  }

  function swallowTheaterPlaybackKeys(event: KeyboardEvent): void {
    if (isChatDocument(window.location.href) || isNativeChatEvent(event)) return;
    const marked = document.querySelector('.theater-everywhere-video-active, [data-theater-everywhere]');
    if (isEditableKeyboardTarget(event.target) || isEditableKeyboardTarget(document.activeElement)) return;
    // The content world owns help focus and native activation of its close button.
    if (queryPlayerUi('.theater-help-overlay')) return;
    // Netflix cancels Space at window capture, including its keyup default.
    // Stop host listeners while retaining the focused button's native action.
    if ((event.key === ' ' || event.key === 'Enter') && event.composedPath().some(node => node instanceof Element
        && node.matches('.theater-service-action-host'))) {
      event.stopPropagation();
      event.stopImmediatePropagation();
      return;
    }
    // Menu buttons own native Space activation, including through the UI's shadow root.
    if (event.composedPath().some(node => node instanceof Element
        && node.matches('.theater-menu'))) return;

    if (isTencentWasmPlayerElement(marked)) {
      if (!mainWorldOwnsWasmPlayPause(event, publishedShortcut('playPause'))) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (event.type !== 'keydown' || event.repeat) return;
      const host = marked as HTMLElement & { paused?: boolean; play?: () => unknown; pause?: () => void };
      if (typeof host.paused !== 'boolean' || typeof host.play !== 'function' || typeof host.pause !== 'function') return;
      const willPause = host.paused === false;
      toggleDirectPlayback({
        paused: host.paused,
        play: () => host.play?.(),
        pause: () => host.pause?.()
      });
      window.dispatchEvent(new CustomEvent('theater-everywhere-playback-intent', {
        detail: { action: willPause ? 'pause' : 'play' }
      }));
      return;
    }

    if (!(marked instanceof HTMLVideoElement)) return;
    const video = marked;
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
    let netflix: Record<string, unknown> | null = null;
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
    try {
      netflix = netflixIntegrationEnabled() ? readNetflixSnapshot() : null;
    } catch {
      netflix = null;
    }
    publishYoutubeProbeSnapshot(youtube);
    window.dispatchEvent(new CustomEvent('theater-everywhere-media-probe-result', {
      detail: { requestId, youtube, vimeo, patreon, twitch, disney, netflix, tencent: readTencentSnapshot(), crunchyroll: readCrunchyrollSnapshot() }
    }));
    // Bilibili needs asynchronous metadata. Keep the original fast probe for
    // other adapters and deliver Bilibili's result through its own event.
    if (bilibiliIntegrationEnabled()) {
      void readBilibiliSnapshot().then((bilibili) => {
        window.dispatchEvent(new CustomEvent('theater-everywhere-bilibili-probe-result', {
          detail: { requestId, bilibili }
        }));
      }).catch(() => {});
    }
    if (bilibiliIntlIntegrationEnabled()) {
      void readBilibiliIntlSnapshot().then((bilibiliIntl) => {
        window.dispatchEvent(new CustomEvent('theater-everywhere-bilibili-intl-probe-result', {
          detail: { requestId, bilibiliIntl }
        }));
      }).catch(() => {});
    }
  });

  function pageFetchAllowed(url: string): boolean {
    if (!isAllowlistedPageFetchUrl(url, window.location.href)) return false;
    const classified = classifyMediaFetchUrl(url, window.location.href);
    if (!classified) return false;
    if (classified.provider === 'youtube') return youtubeIntegrationEnabled();
    if (classified.provider === 'patreon') return patreonIntegrationEnabled();
    if (classified.provider === 'twitch') return twitchIntegrationEnabled();
    if (classified.provider === 'disney') return disneyIntegrationEnabled();
    if (classified.provider === 'bilibili') return bilibiliIntegrationEnabled();
    if (classified.provider === 'bilibiliIntl') return bilibiliIntlIntegrationEnabled();
    if (classified.provider === 'tencent') return tencentIntegrationEnabled();
    if (classified.provider === 'crunchyroll') return crunchyrollAllowsCaptionFetch(url);
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
            const request = classifyMediaFetchUrl(url, window.location.href);
            if (request?.provider === 'tencent' && !assertSafeRedirect(response.url, request)) return null;
            if (request?.provider === 'bilibili' && response.url && !assertSafeRedirect(response.url, request)) return null;
            if (request?.provider === 'bilibiliIntl' && response.url && !assertSafeRedirect(response.url, request)) return null;
            if (request?.provider === 'crunchyroll' && response.url && !assertSafeRedirect(response.url, request)) return null;
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
    const detail = (event as CustomEvent<{ live?: boolean; time?: number; resumeAfterSeek?: boolean; cancelPendingResume?: boolean }>).detail || {};
    const video = findActiveVideo(document) || document.querySelector('video');
    if (handleNetflixMediaSeek(detail, video)) return;
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
