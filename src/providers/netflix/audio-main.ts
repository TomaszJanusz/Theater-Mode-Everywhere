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

/** Cadmium throws before the manifest. Do not turn that into a cached one-track result. */
export function readNetflixAudio(player: NetflixAudioPlayer, mediaId: string): AudioTrackList | null {
  try {
    const raw = player.getAudioTrackList?.();
    const selected = player.getAudioTrack?.();
    if (!Array.isArray(raw) || raw.length > 100) return null;
    const tracks = raw.flatMap(track => netflixAudioTrack(track, selected) ?? []);
    if (tracks.length !== raw.length || new Set(tracks.map(track => track.id)).size !== tracks.length) return null;
    return { mediaId, tracks, blocked: player.getAdManager?.()?.adPresenting !== false };
  } catch { return null; }
}

/** One private bridge owner per page; no player listeners or timers survive the theater adapter. */
export function installNetflixAudio(navigation: NavigationObserver): () => void {
  let binding: Binding | null = null;
  let sequence = 0;
  let stopWatching = () => {};
  let cancelPending = () => {};
  let disposed = false;
  const ping = () => window.dispatchEvent(new CustomEvent(AUDIO_CHANGE));
  const clear = () => {
    cancelPending();
    cancelPending = () => {};
    stopWatching();
    stopWatching = () => {};
    binding = null;
    publishHiddenJson(AUDIO_SNAPSHOT, null);
  };
  const current = (bound: Binding) => {
    try { return binding === bound && same(bound, context(bound.video)); } catch { return false; }
  };
  const changed = () => {
    if (binding && !current(binding)) clear();
    ping();
  };
  const watch = (bound: Binding) => {
    const player = bound.player;
    const attached: string[] = [];
    for (const type of AUDIO_EVENTS) {
      try { player.addEventListener?.(type, changed); attached.push(type); } catch { /* Optional on older players. */ }
    }
    // Structure only: never per-timeupdate reads or polling. Queries/events revalidate session identity.
    const structure = new MutationObserver(() => { if (!bound.video.isConnected || !bound.root.isConnected) changed(); });
    structure.observe(document, { childList: true, subtree: true });
    const flags = new MutationObserver(changed);
    flags.observe(document.documentElement, { attributes: true, attributeFilter: ['data-te-netflix-integration-off'] });
    const stopNavigation = navigation.subscribe(() => { clear(); ping(); });
    window.addEventListener('pagehide', clear);
    stopWatching = () => {
      for (const type of attached) {
        try { player.removeEventListener?.(type, changed); } catch { /* A closed session may throw. */ }
      }
      structure.disconnect(); flags.disconnect();
      stopNavigation();
      window.removeEventListener('pagehide', clear);
    };
  };
  const query = (event: Event) => {
    const request = parseAudioQuery((event as CustomEvent<unknown>).detail);
    const video = event.target;
    if (!request || !(video instanceof HTMLVideoElement)) return;
    let active: Context | null = null;
    try { active = context(video); } catch { /* Session is loading/closed. */ }
    if (!active || request.pageHref !== active.pageHref || request.mediaId !== active.mediaId) { clear(); return; }
    if (!binding || binding.clientId !== request.clientId || !same(binding, active) || binding.observing !== request.observe) {
      clear();
      binding = { ...active, clientId: request.clientId, bindingId: `binding:${++sequence}`, observing: request.observe };
      if (request.observe) watch(binding);
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
  const stop = (event: Event) => { if ((event as CustomEvent<unknown>).detail === binding?.clientId) clear(); };
  const handlers = [[AUDIO_QUERY, query], [AUDIO_SELECT, select], [AUDIO_STOP, stop]] as const;
  for (const [type, listener] of handlers) window.addEventListener(type, listener);
  return () => {
    if (disposed) return;
    disposed = true;
    clear();
    for (const [type, listener] of handlers) window.removeEventListener(type, listener);
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
        const list = readNetflixAudio(player, bound.mediaId);
        if (!current() || !list || list.blocked || !list.tracks.some(track => track.id === request.trackId)) finish(false);
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
