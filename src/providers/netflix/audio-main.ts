import { mediaProviderIntegrationEnabled } from '../../media-features/provider-flags';
import type { AudioTrackList } from '../../media-features/types';
import { publishHiddenJson } from '../../platform/hidden-json';
import type { NavigationObserver } from '../../platform/navigation-visit';

import {
  AUDIO_ACK, AUDIO_CHANGE, AUDIO_EVENTS, AUDIO_QUERY, AUDIO_SELECT, AUDIO_SNAPSHOT, AUDIO_STOP, AUDIO_TIMEOUT,
  netflixAudioTrack, parseAudioQuery, parseAudioSelect, type AudioQuery, type AudioSelect
} from './audio-bridge';
import { NETFLIX_HARVEST_EVENT, netflixVideoId } from './page';
import { findNetflixPlayerRoot, netflixWatchId, readNetflixPlayerAppApi, type NetflixSessionPlayer } from './session';

export type NetflixAudioPlayer = NetflixSessionPlayer & {
  getAudioTrackList?: () => unknown;
  getAudioTrack?: () => unknown;
  setAudioTrack?: (track: object) => unknown;
  getAdManager?: () => { adPresenting?: unknown } | null;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
};
type Context = { sessionId: string; player: NetflixAudioPlayer; root: HTMLElement; video: HTMLVideoElement; pageHref: string; mediaId: string };
type Binding = Context & { clientId: string; bindingId: string; observing: boolean };

function context(video: HTMLVideoElement): Context | null {
  if (!mediaProviderIntegrationEnabled('netflix') || !video.isConnected) return null;
  const mediaId = netflixWatchId(window.location.pathname);
  const root = findNetflixPlayerRoot(document);
  if (!mediaId || !root?.isConnected || !root.contains(video)) return null;
  const api = readNetflixPlayerAppApi()?.videoPlayer;
  for (const sessionId of (api?.getAllPlayerSessionIds?.() ?? []).slice(0, 16)) {
    try {
      const player = api?.getVideoPlayerBySessionId?.(sessionId) as NetflixAudioPlayer | null;
      if (!player || netflixVideoId(player.getMovieId?.()) !== mediaId
        || typeof player.getAudioTrackList !== 'function' || typeof player.getAudioTrack !== 'function'
        || typeof player.setAudioTrack !== 'function') continue;
      const element = player.getElement?.();
      if (!(element instanceof Element) || !element.isConnected || !root.contains(element)
        || (element !== video && !element.contains(video))) continue;
      return { sessionId, player, root, video, pageHref: window.location.href, mediaId };
    } catch { /* Another loading session must not obscure the watch session. */ }
  }
  return null;
}

function same(left: Context, right: Context | null): boolean {
  return right !== null && left.sessionId === right.sessionId && left.root === right.root && left.video === right.video
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
  // Each observing client owns discovery independently of its current session/element.
  // A second reader cannot steal a theater owner's observation or cancel its commands.
  type Owner = { observing: boolean; binding: Binding | null; stopDiscovery(): void; stopPlayer(): void; cancel(): void };
  const owners = new Map<string, Owner>();
  let sequence = 0;
  let disposed = false;
  const ping = () => window.dispatchEvent(new CustomEvent(AUDIO_CHANGE));
  const invalidate = (owner: Owner) => {
    owner.cancel(); owner.cancel = () => {};
    owner.binding = null;
    owner.stopPlayer(); owner.stopPlayer = () => {};
    publishHiddenJson(AUDIO_SNAPSHOT, null);
  };
  const clear = (clientId: string) => {
    const owner = owners.get(clientId);
    if (!owner) return;
    owners.delete(clientId);
    invalidate(owner); owner.stopDiscovery();
  };
  const current = (owner: Owner, bound: Binding) => {
    try { return owner.binding === bound && same(bound, context(bound.video)); } catch { return false; }
  };
  const query = (event: Event) => {
    const request = parseAudioQuery((event as CustomEvent<unknown>).detail);
    const video = event.target;
    if (disposed || !request || !(video instanceof HTMLVideoElement) || request.pageHref !== window.location.href
      || request.mediaId !== netflixWatchId(window.location.pathname)) return;
    if (!video.isConnected || !mediaProviderIntegrationEnabled('netflix')) { clear(request.clientId); return; }
    let owner = owners.get(request.clientId);
    if (!owner) {
      // Bound page-controlled admission: normal operation has one theater owner.
      if (owners.size >= 8) return;
      owner = { observing: false, binding: null, stopDiscovery() {}, stopPlayer() {}, cancel() {} };
      owners.set(request.clientId, owner);
    }
    const owned = owner;
    if (request.observe && !owned.observing) {
      owned.stopDiscovery();
      owned.observing = true;
      owned.stopDiscovery = observeDiscovery(navigation, () => {
        if (owned.binding && !current(owned, owned.binding)) invalidate(owned);
        ping();
      }, () => clear(request.clientId));
    }
    let active: Context | null = null;
    try { active = context(video); } catch { /* Session is loading/closed. */ }
    if (!active) { invalidate(owned); return; }
    const previous = owned.binding;
    if (!previous || !same(previous, active) || previous.observing !== request.observe) {
      invalidate(owned);
      owned.binding = { ...active, clientId: request.clientId, bindingId: `binding:${++sequence}`, observing: request.observe };
    }
    const bound = owned.binding!;
    if (!previous || previous !== bound || previous.player !== active.player) {
      owned.stopPlayer();
      bound.player = active.player;
      owned.stopPlayer = request.observe ? observeAudioPlayer(active.player, ping) : () => {};
    }
    publishHiddenJson(AUDIO_SNAPSHOT, { ...request, bindingId: bound.bindingId, list: readNetflixAudio(active.player, active.mediaId) });

  };
  const select = (event: Event) => {
    const request = parseAudioSelect((event as CustomEvent<unknown>).detail);
    const owner = request ? owners.get(request.clientId) : null;
    const bound = owner?.binding;
    if (!request || !owner || !bound || event.target !== bound.video || !matches(request, bound)) return;
    owner.cancel();
    void selectTrack(bound, request, () => current(owner, bound), finish => { owner.cancel = finish; }).then(ok => {
      window.dispatchEvent(new CustomEvent(AUDIO_ACK, { detail: JSON.stringify({ ...request, ok }) }));
    });
  };
  const stop = (event: Event) => { const id: unknown = (event as CustomEvent<unknown>).detail; if (typeof id === 'string') clear(id); };
  const handlers = [[AUDIO_QUERY, query], [AUDIO_SELECT, select], [AUDIO_STOP, stop]] as const;
  for (const [type, listener] of handlers) window.addEventListener(type, listener);
  return () => {
    if (disposed) return;
    disposed = true;
    for (const id of owners.keys()) clear(id);
    for (const [type, listener] of handlers) window.removeEventListener(type, listener);
  };
}

/** Survives root/session replacement; only the owner ending removes discovery. */
function observeDiscovery(navigation: NavigationObserver, changed: () => void, clear: () => void): () => void {
  const selector = 'video, .watch-video, .nf-player-container, [data-uia="player"]';
  const structure = new MutationObserver(records => {
    if (records.some(record => [...record.addedNodes, ...record.removedNodes].some(node =>
      node instanceof Element && !node.id.startsWith('theater-everywhere-')
      && (node.matches(selector) || node.querySelector(selector))))) changed();
  });
  structure.observe(document, { childList: true, subtree: true });
  const flags = new MutationObserver(() => { if (!mediaProviderIntegrationEnabled('netflix')) clear(); });
  flags.observe(document.documentElement, { attributes: true, attributeFilter: ['data-te-netflix-integration-off'] });
  const stopNavigation = navigation.subscribe(commit => { if (commit !== 'hide') changed(); });
  const events = ['loadedmetadata', 'loadedtracks', 'audiotracklistchanged', NETFLIX_HARVEST_EVENT];
  for (const type of events) window.addEventListener(type, changed, true);
  return () => {
    structure.disconnect(); flags.disconnect(); stopNavigation();
    for (const type of events) window.removeEventListener(type, changed, true);
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
