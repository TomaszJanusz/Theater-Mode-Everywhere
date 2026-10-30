import { mediaProviderIntegrationEnabled } from '../../media-features/provider-flags';
import { publishHiddenJson } from '../../platform/hidden-json';
import { MEDIA_SEEK_EVENT, parseMediaSeekDetail } from '../../protocol/media-seek';

import {
  DISNEY_AUDIO_CHANGE,
  DISNEY_AUDIO_QUERY,
  DISNEY_AUDIO_RESULT,
  DISNEY_AUDIO_SELECT,
  DISNEY_AUDIO_SNAPSHOT,
  DISNEY_AUDIO_TIMEOUT_MS,
  DISNEY_AUDIO_WATCH,
  MAX_DISNEY_AUDIO_TRACKS,
  disneyAudioPlayId,
  isDisneyAudioTrackId,
  parseDisneyAudioSelect,
  parseDisneyAudioWatch,
  type DisneyAudioRecord,
  type DisneyAudioResult,
  type DisneyAudioSnapshot
} from './audio-bridge';

/** Hive debounces `audio.setTrack` (leading and trailing): a pick within this window of the last one lands at its end. */
export const DISNEY_AUDIO_DEBOUNCE_MS = 800;
/** Re-read while a command is pending only: the store notification for the switch is not confirmed on the host. */
export const DISNEY_AUDIO_CHECK_MS = 500;
/** How long after a switch the media reload may still resume a paused title. */
export const DISNEY_RESUME_GRACE_MS = 3_000;
const MAX_WATCHERS = 8;

type HiveRecord = Record<string, unknown>;
type HiveAudio = { availableTracks?: unknown; selectedTrack?: unknown; setTrack?: (track: unknown) => unknown };
type HivePlayer = { audio?: HiveAudio; pause?: () => unknown };
type HiveStore = { getState: () => unknown; subscribe: (listener: () => void) => unknown };
type Live = { web: object; player: HivePlayer; audio: HiveAudio; playId: string };
export type DisneyAudioMediaEvent = 'emptied' | 'loadstart' | 'loadedmetadata' | 'playing';

export type DisneyAudioEnv = {
  enabled(): boolean;
  href(): string;
  /** `disney-web-player` while it is connected. */
  webPlayer(): object | null;
  /** Whether the content video is paused; null when there is none to read. */
  contentPaused(web: object): boolean | null;
  publishSnapshot(payload: DisneyAudioSnapshot | null): void;
  answer(result: DisneyAudioResult): void;
  changed(): void;
  now(): number;
  setTimeout(callback: () => void, ms: number): number;
  clearTimeout(id: number): void;
};

const isRecord = (value: unknown): value is HiveRecord => Boolean(value) && typeof value === 'object';

/** `mediaPlayer` and `stateStore` are expandos on the element; anything inherited is not Hive's. */
function own(target: object, key: string): unknown {
  try {
    return Object.prototype.hasOwnProperty.call(target, key) ? (target as HiveRecord)[key] : undefined;
  } catch {
    return undefined;
  }
}

function trackId(track: unknown): string | null {
  if (!isRecord(track)) return null;
  const id = track.id;
  const text = typeof id === 'number' && Number.isSafeInteger(id) ? String(id) : id;
  return isDisneyAudioTrackId(text) ? text : null;
}

function hiveTracks(audio: HiveAudio): HiveRecord[] {
  const list = audio.availableTracks;
  return Array.isArray(list) ? list.slice(0, MAX_DISNEY_AUDIO_TRACKS).filter(isRecord) : [];
}

const selectedId = (audio: HiveAudio): string | null => trackId(audio.selectedTrack);

function record(track: HiveRecord, selected: string | null): DisneyAudioRecord | null {
  const id = trackId(track);
  if (id === null) return null;
  const display = track.displayName;
  const title = isRecord(display) && typeof display.title === 'string' ? display.title.trim() : '';
  const name = typeof track.name === 'string' ? track.name.trim() : '';
  return {
    id,
    label: (title || name).slice(0, 200),
    language: typeof track.language === 'string' ? track.language.slice(0, 35) : '',
    description: track.hasDescribesVideo === true,
    selected: selected !== null ? id === selected : track.isSelected === true
  };
}

function isStore(value: unknown): value is HiveStore {
  return isRecord(value) && typeof value.getState === 'function' && typeof value.subscribe === 'function';
}

type Command = { requestId: string; live: Live; trackId: string; calledAt: number; deadline: number; check: number };
type Restore = { live: Live; reloadSeen: boolean; end: number | null };
type Subscription = { store: HiveStore; stop: () => void; last: unknown[] };

const sameItem = (a: Live, b: Live) => a.web === b.web && a.player === b.player && a.playId === b.playId;
const sameSignature = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((value, index) => Object.is(value, b[index]));

/**
 * The MAIN half of Disney+ audio: lists Hive's tracks, selects the live track object, and confirms
 * by `selectedTrack`. A switch reloads the media (emptied, loadstart, a new MSE timeline whose
 * `currentTime` restarts) and resumes a paused title on its own; the content position stays in
 * Hive's playhead, which the clock publishes, and a pause the viewer chose is put back here.
 */
export class DisneyAudioHost {
  /** The play id each player was first read under; a player carried over to another title waits for its reload. */
  private readonly seenUnder = new WeakMap<object, string>();
  private readonly watchers = new Set<string>();
  private reloading = false;
  private command: Command | null = null;
  private restore: Restore | null = null;
  private subscription: Subscription | null = null;

  constructor(private readonly env: DisneyAudioEnv) {}

  private read(): Live | null {
    if (!this.env.enabled()) return null;
    const playId = disneyAudioPlayId(this.env.href());
    const web = this.env.webPlayer();
    if (!playId || !web) return null;
    const player = own(web, 'mediaPlayer');
    if (!isRecord(player)) return null;
    const audio = (player as HivePlayer).audio;
    if (!isRecord(audio) || typeof audio.setTrack !== 'function') return null;
    const first = this.seenUnder.get(player);
    if (first === undefined) this.seenUnder.set(player, playId);
    else if (first !== playId) return null;
    return { web, player: player as HivePlayer, audio, playId };
  }

  private safeRead(): Live | null {
    try { return this.read(); } catch { return null; }
  }

  private endRestore(): void {
    if (this.restore?.end != null) this.env.clearTimeout(this.restore.end);
    this.restore = null;
  }

  private finish(ok: boolean): void {
    const done = this.command;
    if (!done) return;
    this.command = null;
    this.env.clearTimeout(done.deadline);
    this.env.clearTimeout(done.check);
    this.env.answer({ requestId: done.requestId, ok });
    if (this.restore && this.restore.end === null) this.restore.end = this.env.setTimeout(() => this.endRestore(), DISNEY_RESUME_GRACE_MS);
    if (this.watchers.size) this.env.changed();
  }

  private check(): void {
    const pending = this.command;
    if (!pending) return;
    const live = this.safeRead();
    // Another title, player or page, or the integration switched off: the pick no longer applies.
    if (!live || !sameItem(live, pending.live) || !hiveTracks(live.audio).some(track => trackId(track) === pending.trackId)) {
      this.finish(false);
      return;
    }
    if (selectedId(live.audio) !== pending.trackId) return;
    // Until the debounce has fired and the reload has finished, a trailing call can still move the selection.
    if (this.reloading || this.env.now() - pending.calledAt < DISNEY_AUDIO_DEBOUNCE_MS) return;
    this.finish(true);
  }

  private signature(store: HiveStore): unknown[] {
    try {
      const state = store.getState() as { player?: { extensions?: { audio?: unknown } } } | null;
      const slice = state?.player?.extensions?.audio;
      if (slice !== undefined) return [slice];
    } catch { /* Fall back to the player's getters. */ }
    const live = this.read();
    return live ? [live.audio.availableTracks, selectedId(live.audio)] : [];
  }

  private unsubscribe(): void {
    const current = this.subscription;
    this.subscription = null;
    try { current?.stop(); } catch { /* Released once. */ }
  }

  /** Follows the current element's store while a theater adapter watches; Redux calls it on every dispatch. */
  private syncSubscription(): void {
    if (!this.watchers.size || !this.env.enabled()) {
      this.unsubscribe();
      return;
    }
    const web = this.env.webPlayer();
    const store = web ? own(web, 'stateStore') : undefined;
    if (this.subscription?.store === store) return;
    this.unsubscribe();
    if (!isStore(store)) return;
    const next: Subscription = { store, stop: () => {}, last: this.signature(store) };
    try {
      const stop = store.subscribe(() => {
        if (this.subscription !== next) return;
        // Playback ticks dispatch too: compare references first and stop there when nothing moved.
        const now = this.signature(store);
        if (sameSignature(now, next.last)) return;
        next.last = now;
        this.check();
        this.env.changed();
      });
      if (typeof stop === 'function') next.stop = () => { stop(); };
      this.subscription = next;
    } catch { /* A store that refuses listeners leaves the pending checks and media events. */ }
  }

  /** Drops what only a watching adapter needs; a track Hive is already switching to is left to it. */
  private release(): void {
    this.unsubscribe();
    this.finish(false);
    this.endRestore();
  }

  query(requestId: unknown): void {
    if (typeof requestId !== 'string' || !/^[\w:-]{1,80}$/.test(requestId)) return;
    let payload: DisneyAudioSnapshot | null = null;
    try {
      const live = this.read();
      if (live) {
        this.syncSubscription();
        const selected = selectedId(live.audio);
        const tracks = hiveTracks(live.audio).flatMap(track => record(track, selected) ?? []);
        payload = { requestId, pageHref: this.env.href(), playId: live.playId, tracks };
      }
    } catch {
      payload = null; // Hive getters can throw while the player attaches.
    }
    this.env.publishSnapshot(payload);
  }

  select(raw: unknown): void {
    const request = parseDisneyAudioSelect(raw);
    if (!request) return;
    const live = this.safeRead();
    let track: HiveRecord | undefined;
    try {
      track = live?.playId === request.playId ? hiveTracks(live.audio).find(candidate => trackId(candidate) === request.trackId) : undefined;
    } catch {
      track = undefined;
    }
    if (!live || !track) {
      this.env.answer({ requestId: request.requestId, ok: false });
      return;
    }
    // The newest pick wins: Hive applies it with the debounce's trailing call.
    const superseded = this.command !== null;
    this.finish(false);
    if (!superseded && selectedId(live.audio) === request.trackId) {
      this.env.answer({ requestId: request.requestId, ok: true });
      return;
    }
    const keepPaused = request.keepPaused || (this.restore !== null && sameItem(this.restore.live, live));
    this.endRestore();
    if (keepPaused) this.restore = { live, reloadSeen: false, end: null };
    try {
      // The live object, never a copy: Hive dispatches it as the selected track.
      live.audio.setTrack?.(track);
    } catch {
      this.endRestore();
      this.env.answer({ requestId: request.requestId, ok: false });
      return;
    }
    this.start(request.requestId, live, request.trackId);
  }

  private start(requestId: string, live: Live, id: string): void {
    const pending: Command = {
      requestId, live, trackId: id, calledAt: this.env.now(),
      deadline: this.env.setTimeout(() => { if (this.command === pending) this.finish(false); }, DISNEY_AUDIO_TIMEOUT_MS),
      check: 0
    };
    const tick = () => {
      if (this.command !== pending) return;
      this.check();
      if (this.command === pending) pending.check = this.env.setTimeout(tick, DISNEY_AUDIO_CHECK_MS);
    };
    this.command = pending;
    pending.check = this.env.setTimeout(tick, DISNEY_AUDIO_CHECK_MS);
  }

  watch(raw: unknown): void {
    const lease = parseDisneyAudioWatch(raw);
    if (!lease) return;
    if (!lease.on) this.watchers.delete(lease.watchId);
    else if (this.watchers.size < MAX_WATCHERS) this.watchers.add(lease.watchId);
    if (this.watchers.size) this.syncSubscription();
    else this.release();
  }

  /** A media event on a video inside the current `disney-web-player`. */
  media(type: DisneyAudioMediaEvent, video: { pause?: () => unknown } | null): void {
    if (type === 'emptied' || type === 'loadstart') {
      this.reloading = true;
      if (this.restore) this.restore.reloadSeen = true;
    } else if (type === 'loadedmetadata') {
      this.reloaded();
    } else {
      this.resumed(video);
    }
  }

  private reloaded(): void {
    this.reloading = false;
    // The reload is what lets a carried-over player describe the page's title, as for the clock.
    const web = this.env.webPlayer();
    const player = web ? own(web, 'mediaPlayer') : undefined;
    const playId = disneyAudioPlayId(this.env.href());
    if (isRecord(player) && playId) this.seenUnder.set(player, playId);
    this.syncSubscription();
    this.check();
    if (this.watchers.size) this.env.changed();
  }

  /** The reload's own resume of a title the viewer had paused: pause it again, through Hive so its state agrees. */
  private resumed(video: { pause?: () => unknown } | null): void {
    const pending = this.restore;
    if (!pending?.reloadSeen) return;
    this.endRestore();
    const live = this.safeRead();
    if (!live || !sameItem(live, pending.live)) return;
    try {
      if (typeof live.player.pause === 'function') live.player.pause();
      else video?.pause?.();
    } catch { /* The player may refuse while its pipeline reattaches. */ }
  }

  /** The viewer toggled playback in theater. Starting a paused title cancels the pause we would put back. */
  playbackToggled(): void {
    if (!this.restore) return;
    const web = this.env.webPlayer();
    if (!web || this.env.contentPaused(web) !== false) this.endRestore();
  }

  /** Ends every lease, as when the last theater adapter is gone. */
  dispose(): void {
    this.watchers.clear();
    this.release();
  }
}

export const createDisneyAudioHost = (env: DisneyAudioEnv) => new DisneyAudioHost(env);

const CONTENT_VIDEO = 'video.hive-video';
let installed = false;

function contentVideo(event: Event): HTMLVideoElement | null {
  const video = event.target;
  if (!(video instanceof HTMLVideoElement) || !video.matches(CONTENT_VIDEO)) return null;
  return document.querySelector('disney-web-player')?.contains(video) ? video : null;
}

export function installDisneyAudio(): void {
  if (installed) return;
  installed = true;
  const host = createDisneyAudioHost({
    enabled: () => mediaProviderIntegrationEnabled('disney'),
    href: () => window.location.href,
    webPlayer: () => {
      const web = document.querySelector('disney-web-player');
      return web?.isConnected ? web : null;
    },
    contentPaused: web => {
      const video = (web as Element).querySelector?.(CONTENT_VIDEO);
      return video instanceof HTMLVideoElement ? video.paused : null;
    },
    publishSnapshot: payload => publishHiddenJson(DISNEY_AUDIO_SNAPSHOT, payload),
    answer: result => window.dispatchEvent(new CustomEvent(DISNEY_AUDIO_RESULT, { detail: JSON.stringify(result) })),
    changed: () => window.dispatchEvent(new CustomEvent(DISNEY_AUDIO_CHANGE)),
    now: () => performance.now(),
    setTimeout: (callback, ms) => window.setTimeout(callback, ms),
    clearTimeout: id => window.clearTimeout(id)
  });
  const detail = (event: Event) => (event as CustomEvent<unknown>).detail;
  window.addEventListener(DISNEY_AUDIO_QUERY, event => host.query(detail(event)));
  window.addEventListener(DISNEY_AUDIO_SELECT, event => host.select(detail(event)));
  window.addEventListener(DISNEY_AUDIO_WATCH, event => host.watch(detail(event)));
  window.addEventListener(MEDIA_SEEK_EVENT, event => {
    if (parseMediaSeekDetail(detail(event))?.cancelPendingResume) host.playbackToggled();
  });
  // Media events do not bubble; capture sees the player's own video before the host's listeners.
  for (const type of ['emptied', 'loadstart', 'loadedmetadata', 'playing'] as const) {
    document.addEventListener(type, event => {
      const video = contentVideo(event);
      if (video) host.media(type, video);
    }, true);
  }
}
