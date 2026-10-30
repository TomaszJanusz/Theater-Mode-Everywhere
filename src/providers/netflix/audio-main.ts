import { NETFLIX_HARVEST_EVENT } from '../../media-features/parsers/netflix-page';
import { mediaProviderIntegrationEnabled } from '../../media-features/provider-flags';
import type { AudioTrackList } from '../../media-features/types';
import { publishHiddenJson } from '../../platform/hidden-json';
import type { NavigationObserver } from '../../platform/navigation-visit';

import {
  AUDIO_ACK, AUDIO_CHANGE, AUDIO_EVENTS, AUDIO_QUERY, AUDIO_SELECT, AUDIO_SNAPSHOT, AUDIO_STOP, AUDIO_TIMEOUT,
  netflixAudioTrack, parseAudioQuery, parseAudioSelect, type AudioQuery, type AudioSelect
} from './audio-bridge';
import { findNetflixPlayerRoot, netflixWatchId, readNetflixPlayerAppApi, selectNetflixSession, type NetflixSessionPlayer } from './session';

export type NetflixAudioPlayer = NetflixSessionPlayer & {
  getAudioTrackList?: () => unknown;
  getAudioTrack?: () => unknown;
  setAudioTrack?: (track: object) => unknown;
  getAdManager?: () => { adPresenting?: unknown } | null;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
};
type Context = { player: NetflixAudioPlayer; root: HTMLElement; video: HTMLVideoElement; pageHref: string; mediaId: string };
type Binding = Context & { clientId: string; bindingId: string; observing: boolean };

function context(video: HTMLVideoElement): Context | null {
  if (!mediaProviderIntegrationEnabled('netflix') || !video.isConnected) return null;
  const mediaId = netflixWatchId(window.location.pathname);
  const root = findNetflixPlayerRoot(document);
  if (!mediaId || !root?.isConnected || !root.contains(video)) return null;
  const player = selectNetflixSession(readNetflixPlayerAppApi(), root, mediaId) as NetflixAudioPlayer | null;
  if (!player || typeof player.getAudioTrackList !== 'function' || typeof player.getAudioTrack !== 'function'
    || typeof player.setAudioTrack !== 'function') return null;
  const element = player.getElement?.();
  if (!(element instanceof Element) || (element !== video && !element.contains(video))) return null;
  return { player, root, video, pageHref: window.location.href, mediaId };
}

function same(left: Context, right: Context | null): boolean {
  return right !== null && left.player === right.player && left.root === right.root && left.video === right.video
    && left.pageHref === right.pageHref && left.mediaId === right.mediaId;
}

/** Cadmium exposes an observable; older players may expose the boolean directly. */
export function netflixAudioBlocked(player: NetflixAudioPlayer): boolean {
  try {
    const presenting = player.getAdManager?.()?.adPresenting;
    const value = typeof presenting === 'object' && presenting !== null
      ? (presenting as { value?: unknown }).value : presenting;
    return value !== false;
  } catch { return true; }
}

/** Cadmium throws before the manifest. Do not turn that into a cached one-track result. */
export function readNetflixAudio(player: NetflixAudioPlayer, mediaId: string): AudioTrackList | null {
  try {
    const raw = player.getAudioTrackList?.();
    const selected = player.getAudioTrack?.();
    if (!Array.isArray(raw) || raw.length > 100) return null;
    const tracks = raw.flatMap(track => netflixAudioTrack(track, selected) ?? []);
    if (tracks.length !== raw.length || new Set(tracks.map(track => track.id)).size !== tracks.length || JSON.stringify(tracks).length > 55_000) return null;
    return { mediaId, tracks, blocked: netflixAudioBlocked(player) };
  } catch { return null; }
}

/** One private bridge owner per page; no player listeners or timers survive the theater adapter. */
export function installNetflixAudio(navigation: NavigationObserver): () => void {
  let binding: Binding | null = null;
  let ownerClient: string | null = null;
  let ownerVideo: HTMLVideoElement | null = null;
  let observing = false;
  let sequence = 0;
  let stopDiscovery = () => {};
  let stopPlayer = () => {};
  let cancelPending = () => {};
  let disposed = false;
  const ping = () => window.dispatchEvent(new CustomEvent(AUDIO_CHANGE));
  const invalidate = () => {
    cancelPending();
    cancelPending = () => {};
    binding = null;
    publishHiddenJson(AUDIO_SNAPSHOT, null);
  };
  const clear = () => {
    invalidate();
    ownerClient = null;
    ownerVideo = null;
    observing = false;
    stopPlayer(); stopDiscovery();
    stopPlayer = () => {};
    stopDiscovery = () => {};
  };
  const current = (bound: Binding) => {
    try { return binding === bound && same(bound, context(bound.video)); } catch { return false; }
  };
  const changed = () => {
    if (binding && !current(binding)) {
      const connected = binding.video.isConnected && binding.root.isConnected;
      if (connected && mediaProviderIntegrationEnabled('netflix')) invalidate();
      else clear();
    }
    ping();
  };
  const query = (event: Event) => {
    const request = parseAudioQuery((event as CustomEvent<unknown>).detail);
    const video = event.target;
    if (!request || !(video instanceof HTMLVideoElement) || request.pageHref !== window.location.href
      || request.mediaId !== netflixWatchId(window.location.pathname)) return;
    if (!video.isConnected || !mediaProviderIntegrationEnabled('netflix')) { clear(); return; }
    if (ownerClient !== request.clientId || ownerVideo !== video || observing !== request.observe) {
      clear();
      ownerClient = request.clientId;
      ownerVideo = video;
      observing = request.observe;
      if (observing) stopDiscovery = observeDiscovery(video, navigation, {
        changed, clear, navigate: () => { invalidate(); ping(); }
      });
    }
    let active: Context | null = null;
    try { active = context(video); } catch { /* Session is loading/closed. */ }
    if (!active || request.pageHref !== active.pageHref || request.mediaId !== active.mediaId) {
      invalidate();
      // During SPA handoff the URL can precede the session manifest. Keep the discovery
      // events until the next session can bind, but release disconnected/disabled players.
      if (!video.isConnected || !mediaProviderIntegrationEnabled('netflix')) clear();
      return;
    }
    if (!binding || binding.clientId !== request.clientId || !same(binding, active) || binding.observing !== request.observe) {
      invalidate();
      stopPlayer();
      binding = { ...active, clientId: request.clientId, bindingId: `binding:${++sequence}`, observing: request.observe };
      stopPlayer = request.observe ? observeAudioPlayer(binding.player, changed) : () => {};
    }
    publishHiddenJson(AUDIO_SNAPSHOT, { ...request, bindingId: binding.bindingId, list: readNetflixAudio(binding.player, binding.mediaId) });
  };
  const select = (event: Event) => {
    const request = parseAudioSelect((event as CustomEvent<unknown>).detail);
    const bound = binding;
    if (!request || !bound || event.target !== bound.video || !matches(request, bound)) return;
    cancelPending();
    void selectTrack(bound, request, () => current(bound), finish => { cancelPending = finish; }).then(ok => {
      window.dispatchEvent(new CustomEvent(AUDIO_ACK, { detail: JSON.stringify({ ...request, ok }) }));
    });
  };
  const stop = (event: Event) => { if ((event as CustomEvent<unknown>).detail === ownerClient) clear(); };
  const handlers = [[AUDIO_QUERY, query], [AUDIO_SELECT, select], [AUDIO_STOP, stop]] as const;
  for (const [type, listener] of handlers) window.addEventListener(type, listener);
  return () => {
    if (disposed) return;
    disposed = true;
    clear();
    for (const [type, listener] of handlers) window.removeEventListener(type, listener);
  };
}

/** Discovery exists even before Cadmium has a matching session to subscribe to. */
function observeDiscovery(video: HTMLVideoElement, navigation: NavigationObserver, callbacks: {
  changed(): void; clear(): void; navigate(): void;
}): () => void {
  const root = findNetflixPlayerRoot(document);
  const structure = new MutationObserver(() => {
    if (!video.isConnected || (root && !root.isConnected)) { callbacks.clear(); callbacks.changed(); }
  });
  structure.observe(document, { childList: true, subtree: true });
  const flags = new MutationObserver(() => {
    if (!mediaProviderIntegrationEnabled('netflix')) callbacks.clear();
    callbacks.changed();
  });
  flags.observe(document.documentElement, { attributes: true, attributeFilter: ['data-te-netflix-integration-off'] });
  const stopNavigation = navigation.subscribe(callbacks.navigate);
  const discoveryEvents = ['loadedmetadata', 'loadedtracks', 'audiotracklistchanged', NETFLIX_HARVEST_EVENT];
  for (const type of discoveryEvents) window.addEventListener(type, callbacks.changed, true);
  window.addEventListener('pagehide', callbacks.clear);
  return () => {
    structure.disconnect(); flags.disconnect(); stopNavigation();
    for (const type of discoveryEvents) window.removeEventListener(type, callbacks.changed, true);
    window.removeEventListener('pagehide', callbacks.clear);
  };
}

function observeAudioPlayer(player: NetflixAudioPlayer, changed: () => void): () => void {
  const attached = new Map<string, () => void>();
  for (const type of AUDIO_EVENTS) {
    const listener = () => {
      changed();
      // The legacy caption probe owns its snapshot; ask it to refresh a rebuilt host list.
      if (type.startsWith('timedtext')) window.dispatchEvent(new CustomEvent(NETFLIX_HARVEST_EVENT));
    };
    try { player.addEventListener?.(type, listener); attached.set(type, listener); } catch { /* Optional on older players. */ }
  }
  return () => {
    for (const [type, listener] of attached) {
      try { player.removeEventListener?.(type, listener); } catch { /* A closed session may throw. */ }
    }
  };
}

function matches(request: AudioSelect | AudioQuery, bound: Binding): boolean {
  return request.pageHref === bound.pageHref && request.mediaId === bound.mediaId && request.clientId === bound.clientId
    && (!('bindingId' in request) || request.bindingId === bound.bindingId);
}

/** Await the host, then observe its active track. Returning from setAudioTrack alone proves nothing. */
function selectTrack(bound: Binding, request: AudioSelect, current: () => boolean, ownCancel: (cancel: () => void) => void): Promise<boolean> {
  return new Promise(resolve => {
    let settled = false;
    let returned = false;
    const player = bound.player;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      for (const type of AUDIO_EVENTS) {
        try { player.removeEventListener?.(type, check); } catch { /* Closed session. */ }
      }
      resolve(ok);
    };
    const check = () => {
      try {
        if (!current() || netflixAudioBlocked(player)) { finish(false); return; }
        const list = readNetflixAudio(player, bound.mediaId);
        // Audio changes can temporarily invalidate both getters or rebuild an empty list.
        // Keep waiting for player events within the same command deadline and session.
        if (!list || list.tracks.length === 0) return;
        if (list.blocked || !list.tracks.some(track => track.id === request.trackId)) finish(false);
        else if (returned && list.tracks.some(track => track.id === request.trackId && track.selected)) finish(true);
      } catch { finish(false); }
    };
    const timer = window.setTimeout(() => finish(false), AUDIO_TIMEOUT);
    ownCancel(() => finish(false));
    try {
      const list = readNetflixAudio(player, bound.mediaId);
      if (!current() || !list || list.blocked || !list.tracks.some(track => track.id === request.trackId)) { finish(false); return; }
      // Resolve the *current* object; Cadmium rejects a copied object with the same trackId.
      const raw = player.getAudioTrackList?.();
      const track: unknown = Array.isArray(raw) ? raw.find(item => netflixAudioTrack(item, null)?.id === request.trackId) : null;
      if (!track || typeof track !== 'object') { finish(false); return; }
      for (const type of AUDIO_EVENTS) player.addEventListener?.(type, check);
      Promise.resolve(player.setAudioTrack?.(track)).then(() => { returned = true; check(); }, () => finish(false));
    } catch { finish(false); }
  });
}
