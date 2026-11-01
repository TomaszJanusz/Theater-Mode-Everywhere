import { isNativeChatEvent } from '../chat/events';
import { isChatDocument } from '../chat/url';
import { isHostPlayControlLabel, mainWorldOwnsWasmPlayPause, toggleDirectPlayback } from '../host-play';
import { mediaProviderIntegrationEnabled, type MediaProviderId } from '../media-features/provider-flags';
import { CC_SEARCH_KEY_EVENT } from '../protocol/cc-search';
import { MEDIA_SEEK_EVENT, parseMediaSeekDetail } from '../protocol/media-seek';
import { MODAL_KEY_EVENT } from '../protocol/modal';
import { parseProbeRequest } from '../protocol/page-requests';
import { createWorldMessage, isSameWindowMessage, readWorldEnvelope, type WorldEnvelope } from '../protocol/world-messages';
import { consumeCrunchyrollWrappedFetch, crunchyrollAllowsCaptionFetch, crunchyrollIntegrationEnabled, isCrunchyrollOwnedRequest, harvestCrunchyrollBody, harvestCrunchyrollData, installCrunchyrollMain, readCrunchyrollSnapshot, rememberCrunchyrollBif } from '../providers/crunchyroll/main';
import { } from '../providers/hosts';
import { qualifyNetworkHarvest, harvestBodyFormat, harvestFetchFormatMatches, type NetworkHarvestTarget } from '../providers/network-harvest';
import { HOST_PLAY_CONTROL_SELECTOR } from '../providers/play-controls';
import type { ProviderHarvest } from '../providers/provider-api';
import { markFetchPatched, shouldPatchMainWorld } from '../providers/registry';
import { providerRegistry, registeredEvents } from '../providers/runtime-registration';
import { installWatchPlaybackQueries } from '../providers/watch-playback';
import { ENTRY_SHORTCUT_ATTRIBUTE, ENTRY_SHORTCUT_EVENT } from '../ui/entry-shortcuts';
import { queryPlayerUi, PLAYER_NATIVE_ACTIVATION_SELECTOR } from '../ui/root';
import { matchesShortcut } from '../ui/shortcuts';

import { findActiveVideo } from './active-video';
import { readCurrentBlobText } from './blob-text';
import { MAX_BINARY_HARVEST_BYTES } from './bounded-body';
import { isOwnedHarvestInput, isOwnedHarvestResponse, markOwnedHarvestResponse } from './harvest-ownership';
import { installMediaAudioRuntime } from './media-audio-runtime';
import { classifyMediaFetchUrl, isAllowedPageFetchUrl as isAllowlistedPageFetchUrl, MAX_CAPTION_BYTES } from './media-url-policy';
import { installVisitSignal } from './navigation-visit';
import { readPageResponseBytes } from './page-body';
import { fetchPageMedia } from './page-fetch';
import { answerProviderProbes } from './provider-probe';
import { noteWrapperFailure } from './wrapper-failures';
import { installXhrHarvest } from './xhr-harvest';

/** After the observers exist, so a provider's first responses are seen; a failing install drops only that provider. */
function installProviders(): void {
  for (const hooks of providerRegistry.all()) {
    try { hooks.install?.(); } catch { providerRegistry.fail(hooks.id); }
  }
}

/** Registered providers answer the probe for themselves; a failing read reports null like the others. */
function probeProviders(): Record<string, unknown> {
  const providers: Record<string, unknown> = {};
  for (const hooks of providerRegistry.all()) {
    if (!hooks.probe) continue;
    try { providers[hooks.id] = hooks.probe(); } catch { providers[hooks.id] = null; }
  }
  return providers;
}

function wrapsFetch(harvests: readonly ProviderHarvest[]): boolean {
  return harvests.every(harvest => harvest.wrapFetch !== false);
}

export function installMainWorldRuntime(): void {
  if (isChatDocument(window.location.href)) return;
  const FETCH_WRAPPED = Symbol.for('theater-everywhere.wrapped-fetch');
  // Capture the capability operations before host code can replace the prototypes.
  const postPortMessage: (port: MessagePort, message: WorldEnvelope) => void = Function.prototype.call.bind(MessagePort.prototype.postMessage);
  const closePort: (port: MessagePort) => void = Function.prototype.call.bind(MessagePort.prototype.close);
  const stopMessage: (event: Event) => void = Function.prototype.call.bind(Event.prototype.stopImmediatePropagation);
  // A replacement transport may return a URL-less Response. Keep its known
  // request URL so only genuinely URL-less host metadata uses the fallback.
  const responseUrls = new WeakMap<Response, string>();

  function requestUrl(input: RequestInfo | URL): string {
    if (typeof input === 'string') return input;
    if (input instanceof URL) return input.toString();
    if (input && typeof input === 'object' && 'url' in input) return String((input as Request).url);
    return '';
  }

  // Registration closed before startup, so this list is complete before any observer is installed.
  type RegisteredHarvest = { provider: MediaProviderId; harvest: ProviderHarvest };
  const registered: RegisteredHarvest[] = providerRegistry.all().flatMap(hooks => hooks.harvest ? [{ provider: hooks.id, harvest: hooks.harvest }] : []);
  const harvests = registered.map(entry => entry.harvest);
  type ProviderTarget = RegisteredHarvest & { id: string };
  type HarvestTarget = NetworkHarvestTarget | ProviderTarget;
  const isProviderTarget = (target: HarvestTarget | null): target is ProviderTarget => typeof target === 'object' && target !== null;

  function harvestTarget(url: string): HarvestTarget | null {
    if (isCrunchyrollOwnedRequest(url)) return null;
    const legacy = qualifyNetworkHarvest({
      hostname: window.location.hostname,
      flags: { crunchyroll: crunchyrollIntegrationEnabled() }
    }, url);
    if (legacy) return legacy;
    for (const entry of registered) {
      const id = entry.harvest.qualify(url, window.location.href);
      if (id) return { ...entry, id };
    }
    return null;
  }

  const isBinaryTarget = (target: HarvestTarget | null) => isProviderTarget(target) && target.harvest.binaryTargets?.includes(target.id) === true;

  /** One bounded read of a binary target's owned body; the bytes reach the provider only while its integration is on. */
  function harvestBinary(target: ProviderTarget, url: string, body: Response | Blob | ArrayBuffer): void {
    const enabled = () => mediaProviderIntegrationEnabled(target.provider);
    if (!enabled()) return;
    if (body instanceof ArrayBuffer) {
      if (body.byteLength <= MAX_BINARY_HARVEST_BYTES) target.harvest.binary?.(target.id, url, body);
      return;
    }
    if (body instanceof Blob && body.size > MAX_BINARY_HARVEST_BYTES) return;
    readPageResponseBytes(body instanceof Blob ? { body: body.stream() } : body, MAX_BINARY_HARVEST_BYTES, undefined, { isCurrent: enabled })
      .then(bytes => { if (bytes && enabled()) target.harvest.binary?.(target.id, url, bytes); })
      .catch((error: unknown) => noteWrapperFailure('binary', error));
  }

  /** Format checks treat a registered provider's target as text or JSON metadata. */
  const formatTarget = (target: HarvestTarget | null) => isProviderTarget(target) ? 'provider' as const : target;

  function harvestJson(target: HarvestTarget | null, url: string, data: unknown): void {
    if (isBinaryTarget(target)) return;
    if (isProviderTarget(target)) { target.harvest.json?.(target.id, url, data); return; }
    if (target === 'crunchyroll') harvestCrunchyrollData(url, data);
  }

  function harvestText(target: HarvestTarget | null, url: string, text: string): void {
    if (isBinaryTarget(target)) return;
    if (isProviderTarget(target)) { target.harvest.text?.(target.id, url, text); return; }
    if (target === 'crunchyroll') harvestCrunchyrollBody(url, text);
  }

  // Before any host script: a provider reading Blob bodies needs every later navigation to end the visit.
  const visit = harvests.some(harvest => harvest.blobTextTargets) ? installVisitSignal() : null;

  /** Each selected consumer owns this single clone. Its text/json read bypasses the host Response observers to avoid a second harvest. */
  function consumeFetchClone(target: HarvestTarget | null, url: string, response: Response): void {
    if (!isProviderTarget(target)) return;
    if (isBinaryTarget(target)) harvestBinary(target, url, markOwnedHarvestResponse(response.clone()));
    else if (target.harvest.cloneTargets?.includes(target.id)) target.harvest.response?.(target.id, url, markOwnedHarvestResponse(response.clone()));
  }

  function wrapFetch(fn: typeof fetch): typeof fetch {
    const tagged = fn as typeof fetch & { [FETCH_WRAPPED]?: boolean };
    if (tagged[FETCH_WRAPPED]) return fn;
    const wrapped = function(this: Window, input: RequestInfo | URL): Promise<Response> {
      let url = '';
      try { url = requestUrl(input); } catch (error) { noteWrapperFailure('fetch-input', error); }
      return Promise.resolve(fn.apply(this, arguments as unknown as [RequestInfo | URL, RequestInit?])).then((response) => {
        try {
          responseUrls.set(response, response.url || url);
          if (isOwnedHarvestInput(input)) {
            markOwnedHarvestResponse(response);
            return response;
          }
          if (!response.ok) return response;
          if (consumeCrunchyrollWrappedFetch(url, response, () => false) === 'foreign') {
            const finalUrl = response.url || url;
            const target = finalUrl ? harvestTarget(finalUrl) : null;
            const length = Number(response.headers.get('content-length'));
            const binary = isBinaryTarget(target);
            const cap = binary ? MAX_BINARY_HARVEST_BYTES : MAX_CAPTION_BYTES;
            if ((!binary && !harvestFetchFormatMatches(formatTarget(target), response.headers.get('content-type') || '')) || length > cap) return response;
            consumeFetchClone(target, finalUrl, response);
          }
        } catch (error) {
          // Harvest must not break the page's fetch.
          noteWrapperFailure('fetch', error);
        }
        return response;
      });
    } as typeof fetch & { [FETCH_WRAPPED]?: boolean };
    wrapped[FETCH_WRAPPED] = true;
    return wrapped;
  }

  const harvestHost = shouldPatchMainWorld(window.location.hostname) || harvests.length > 0;
  if (harvestHost && markFetchPatched(window)) {
    const originalResponseJson = Response.prototype.json;
    Response.prototype.json = function(this: Response) {
      const result = originalResponseJson.apply(this, arguments as unknown as []);
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        (result as Promise<unknown>).then((data) => {
          try {
            if (!this.ok || isOwnedHarvestResponse(this)) return;
            const url = this.url || responseUrls.get(this) || '';
            harvestJson(harvestTarget(url), url, data);
          } catch (error) {
            // Ignore harvest failures from host JSON parsing.
            noteWrapperFailure('response-json', error);
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
            if (!text || !this.ok || isOwnedHarvestResponse(this)) return;
            const url = this.url || responseUrls.get(this) || '';
            harvestText(harvestTarget(url), url, text);
          } catch (error) {
            // Ignore harvest failures from host text parsing.
            noteWrapperFailure('response-text', error);
          }
        }).catch(() => {});
      }
      return result;
    };

    // A registered provider whose host replaces fetch with its own transport vetoes the wrapper
    // (`wrapFetch: false`); Response JSON/text observers and XHR still harvest.
    if (wrapsFetch(harvests)) {
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
      const target = harvestTarget(url);
      if (!target) return;
      if (isProviderTarget(target) && isBinaryTarget(target)) {
        if (xhr.response instanceof ArrayBuffer || xhr.response instanceof Blob) harvestBinary(target, url, xhr.response);
        return;
      }
      // Opted-in Blob bodies only, read as bounded text once; a read that outlives its deadline or a navigation is stale.
      if (visit && isProviderTarget(target) && xhr.responseType === 'blob') {
        if (xhr.response instanceof Blob && (target.harvest.blobTextTargets || []).includes(target.id)) {
          readCurrentBlobText(xhr.response, MAX_CAPTION_BYTES, visit)
            .then(text => { if (text) harvestText(target, url, text); })
            .catch((error: unknown) => noteWrapperFailure('xhr', error));
        }
        return;
      }
      if (target === 'crunchyroll-url') { harvestCrunchyrollBody(url, ''); return; }
      const format = harvestBodyFormat(formatTarget(target), xhr.responseType);
      if (format === 'binary') {
        if (xhr.response instanceof ArrayBuffer) rememberCrunchyrollBif(xhr.response, url);
      } else if (format === 'json') {
        harvestJson(target, url, xhr.response);
      } else if (format === 'text') {
        // Only qualified textual endpoints decode an ArrayBuffer. BIF and
        // responseType=json never pass through this materialization boundary.
        const body = xhr.responseType === 'arraybuffer'
          ? xhr.response instanceof ArrayBuffer ? new TextDecoder().decode(xhr.response) : null
          : xhr.responseText;
        if (body) harvestText(target, url, body);
      }
    });
  }

  if (harvestHost || providerRegistry.all().some(hooks => hooks.watchPlayback)) installWatchPlaybackQueries();

  installProviders();
  if (harvestHost) installCrunchyrollMain();

  installMediaAudioRuntime();

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
    let config: { toggle?: unknown; fullscreen?: unknown; exit?: unknown };
    try { config = JSON.parse(document.documentElement.getAttribute(ENTRY_SHORTCUT_ATTRIBUTE) || '{}'); }
    catch { return; }
    // Exit is relayed too: the content world only claims it while a session is open.
    if (!config || !(typeof config.toggle === 'string' && matchesShortcut(event, config.toggle))
        && !(typeof config.fullscreen === 'string' && matchesShortcut(event, config.fullscreen))
        && !(typeof config.exit === 'string' && matchesShortcut(event, config.exit))) return;
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

  const modalKeys = new Set<string>();
  const ccSearchKeys = new Set<string>();
  function swallowTheaterPlaybackKeys(event: KeyboardEvent): void {
    const modal = queryPlayerUi<HTMLElement>('.te-dialog-overlay > .te-dialog[aria-modal="true"]');
    const identity = event.code || event.key;
    if (modal || modalKeys.has(identity)) {
      if (event.type === 'keydown') modalKeys.add(identity);
      if (event.type === 'keyup') modalKeys.delete(identity);
      // Stop host window-capture shortcuts while preserving native input defaults.
      // Only focus navigation/dismissal needs forwarding to the isolated controller.
      const dismissShortcut = modal?.dataset.dismissShortcut;
      const dismiss = event.key === 'Escape' || Boolean(dismissShortcut && matchesShortcut(event, dismissShortcut));
      if (modal && event.type === 'keydown' && (dismiss || event.key === 'Tab')) {
        const relay = new CustomEvent(MODAL_KEY_EVENT, { cancelable: true,
          detail: dismiss ? 'escape' : event.shiftKey ? 'previous' : 'next' });
        modal.dispatchEvent(relay);
        if (relay.defaultPrevented) event.preventDefault();
      }
      event.stopImmediatePropagation();
      return;
    }
    const search = event.composedPath().find((node): node is HTMLInputElement =>
      node instanceof HTMLInputElement && node.matches('.theater-cc-search-input'));
    if ((search && search.closest('.theater-cc-menu')) || ccSearchKeys.has(identity)) {
      if (event.type === 'keydown') ccSearchKeys.add(identity);
      if (event.type === 'keyup') ccSearchKeys.delete(identity);
      if (search && event.type === 'keydown' && !event.isComposing && ['Escape', 'ArrowDown', 'Enter'].includes(event.key)) {
        const relay = new CustomEvent(CC_SEARCH_KEY_EVENT, { cancelable: true, detail: event.key });
        search.dispatchEvent(relay);
        if (relay.defaultPrevented) event.preventDefault();
      }
      event.stopImmediatePropagation();
      return;
    }
    if (isChatDocument(window.location.href) || isNativeChatEvent(event)) return;
    if (event.type === 'keypress') return;
    const marked = document.querySelector('.theater-everywhere-video-active, [data-theater-everywhere]');
    if (event.composedPath().some(isEditableKeyboardTarget) || isEditableKeyboardTarget(document.activeElement)) return;
    // Netflix cancels Space at window capture, including its keyup default.
    // Stop host listeners while retaining the focused button's native action.
    if ((event.key === ' ' || event.key === 'Enter') && event.composedPath().some(node => node instanceof Element
        && node.matches('.theater-service-action-host'))) {
      event.stopPropagation();
      event.stopImmediatePropagation();
      return;
    }
    // Shared player controls own native Space/Enter activation in both worlds.
    if (event.composedPath().some(node => node instanceof Element
        && node.matches(PLAYER_NATIVE_ACTIVATION_SELECTOR))) return;

    // Non-video host players handle playback through their own API.
    if (marked && providerRegistry.all().some(hooks => hooks.playbackElement?.(marked))) {
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

  window.addEventListener('blur', () => { modalKeys.clear(); ccSearchKeys.clear(); });
  window.addEventListener('keydown', swallowTheaterPlaybackKeys, true);
  window.addEventListener('keyup', swallowTheaterPlaybackKeys, true);
  window.addEventListener('keypress', swallowTheaterPlaybackKeys, true);

  answerProviderProbes(window, providerRegistry.get, mediaProviderIntegrationEnabled);

  window.addEventListener('theater-everywhere-media-probe', (event: Event) => {
    const requestId = parseProbeRequest((event as CustomEvent<unknown>).detail);
    if (requestId === null) return;
    window.dispatchEvent(new CustomEvent('theater-everywhere-media-probe-result', {
      detail: { requestId, providers: probeProviders(), crunchyroll: readCrunchyrollSnapshot() }
    }));
  });

  function pageFetchAllowed(url: string): boolean {
    if (!isAllowlistedPageFetchUrl(url, window.location.href)) return false;
    const classified = classifyMediaFetchUrl(url, window.location.href);
    if (!classified) return false;
    if (classified.provider === 'crunchyroll') return crunchyrollAllowsCaptionFetch(url);
    if (providerRegistry.get(classified.provider)) return mediaProviderIntegrationEnabled(classified.provider);
    return false;
  }

  function handlePageFetch(requestId: string, url: string, nonce: string, origin: string, port: MessagePort): void {
    const respond = (ok: boolean, body?: string) => {
      try {
        postPortMessage(port, createWorldMessage('PAGE_FETCH_RESULT', { ok, body }, requestId, nonce, origin));
      } finally {
        closePort(port);
      }
    };
    try {
      if (!pageFetchAllowed(url)) {
        respond(false);
        return;
      }
      const href = window.location.href;
      let owned: Promise<string | null> | null = null;
      for (const hooks of providerRegistry.all()) owned ??= hooks.pageFetch?.(url) ?? null;
      const load = owned ?? (async () => {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 15_000);
          try {
            const response = await fetchPageMedia(url, { credentials: 'omit', signal: controller.signal });
            if (!response) return null;
            const buffer = await readPageResponseBytes(response, MAX_CAPTION_BYTES, controller.signal, {
              isCurrent: () => window.location.href === href && pageFetchAllowed(url), navigationStart: registeredEvents('navigationStart')
            });
            return buffer ? new TextDecoder().decode(buffer) : null;
          } finally {
            clearTimeout(timeout);
          }
        })();
      load
        .then((text) => respond(window.location.href === href && Boolean(text), window.location.href === href ? text || undefined : undefined))
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
    const port = event.ports[0];
    if (!port || event.ports.length !== 1) return;
    // Claim the reply capability before later page listeners can observe it. Both
    // worlds boot at document_start; the envelope carries no shared secret.
    // This assumes our capture listener runs first: earlier page code (including
    // inherited about:blank documents) or tampered MAIN APIs can still intercept
    // the handoff. MAIN fetch/host data are not trusted against a hostile host.
    stopMessage(event);
    handlePageFetch(envelope.requestId, url, envelope.nonce, envelope.origin, port);
  }, { capture: true });

  window.addEventListener(MEDIA_SEEK_EVENT, (event: Event) => {
    const detail = parseMediaSeekDetail((event as CustomEvent<unknown>).detail);
    if (!detail) return;
    const video = findActiveVideo(document) || document.querySelector('video');
    if (providerRegistry.all().some(hooks => hooks.seek?.(detail, video))) return;
    if (video instanceof HTMLVideoElement && typeof detail.time === 'number' && Number.isFinite(detail.time)) {
      video.currentTime = detail.time;
    }
  });

}
