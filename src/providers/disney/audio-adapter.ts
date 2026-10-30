import { mediaProviderIntegrationEnabled } from '../../media-features/provider-flags';
import type { AudioTrackList, CaptionActivationResult, CaptionTrack, MediaCapabilities, MediaFeaturesAdapter } from '../../media-features/types';

import {
  DISNEY_AUDIO_CHANGE,
  DISNEY_AUDIO_QUERY,
  DISNEY_AUDIO_RESULT,
  DISNEY_AUDIO_SELECT,
  DISNEY_AUDIO_SNAPSHOT,
  DISNEY_AUDIO_TIMEOUT_MS,
  DISNEY_AUDIO_WATCH,
  disneyAudioPlayId,
  disneyAudioTracks,
  parseDisneyAudioResult,
  parseDisneyAudioSnapshot,
  type DisneyAudioSelect
} from './audio-bridge';

/** MAIN gives up at its own timeout; this one only covers a MAIN that never answers. */
const ANSWER_TIMEOUT_MS = DISNEY_AUDIO_TIMEOUT_MS + 2_000;

let requestCounter = 0;
const nextRequestId = () => `${Date.now()}:${++requestCounter}`;

export type DisneyAudioClock = { setTimeout(callback: () => void, ms: number): number; clearTimeout(id: number): void };
/** One retry at a time while the list is degraded, visible and observed; healthy playback runs no audio timer. */
const RECOVERY_DELAYS = [250, 500, 1_000, 2_000, 5_000];

/**
 * Disney+ audio tracks for the theater, beside the legacy Disney adapter that owns captions,
 * previews and the title. Every read goes to MAIN, since Hive switches tracks itself. A read that
 * fails for a title that already listed its tracks keeps them, stale and not selectable, until a
 * retry or a host notification reads them again; another title, RTE-off and exit forget them.
 */
export class DisneyAudioAdapter implements MediaFeaturesAdapter {
  private disposed = false;
  /** Settles every unanswered selection as refused on disposal. */
  private readonly pending = new Set<() => void>();
  private readonly releases = new Set<() => void>();
  private readonly listeners = new Set<() => void>();
  /** The last list of two or more tracks for `title`. */
  private known: AudioTrackList | null = null;
  private title: string | null = null;
  private retry: number | null = null;
  private retryStep = 0;

  constructor(
    private readonly video: HTMLVideoElement | null,
    private readonly doc: Document = document,
    private readonly clock: DisneyAudioClock = {
      setTimeout: (callback, ms) => window.setTimeout(callback, ms), clearTimeout: id => window.clearTimeout(id)
    }
  ) {}

  private get view(): Window | null {
    return this.doc.defaultView;
  }

  private playId(): string | null {
    return disneyAudioPlayId(this.view?.location.href ?? '');
  }

  async probe(): Promise<MediaCapabilities> {
    return { captions: false, chapters: false, previews: false };
  }

  async listCaptionTracks(): Promise<CaptionTrack[]> {
    return [];
  }

  async activateCaptionTrack(): Promise<CaptionActivationResult> {
    return { status: 'off', delivery: 'none', cues: [] };
  }

  /** Live MAIN read for the page's own title; null when MAIN does not answer for it. */
  private read(): AudioTrackList | null {
    const view = this.view;
    const playId = this.playId();
    if (this.disposed || !view || !playId) return null;
    const requestId = nextRequestId();
    const pageHref = view.location.href;
    view.dispatchEvent(new CustomEvent(DISNEY_AUDIO_QUERY, { detail: requestId }));
    const snapshot = parseDisneyAudioSnapshot(this.doc.getElementById(DISNEY_AUDIO_SNAPSHOT)?.textContent, requestId, pageHref);
    if (!snapshot || snapshot.playId !== playId) return null;
    // Disney+ ad state is not detected (Hive's interstitials were never seen populated), so nothing blocks a pick; TME-203.
    return { mediaId: playId, tracks: disneyAudioTracks(snapshot.tracks), blocked: false, bindingId: snapshot.bindingId };
  }

  listAudioTracks(): AudioTrackList | null {
    const playId = this.playId();
    if (this.disposed || !mediaProviderIntegrationEnabled('disney')) {
      this.forget();
      return null;
    }
    // The play id is the title; a player that cannot be read for a moment is not a new one.
    if (playId !== this.title) {
      this.forget();
      this.title = playId;
    }
    if (!playId) return null;
    const list = this.read();
    if (list && list.tracks.length >= 2) {
      this.known = list;
      this.stopRecovery();
      return list;
    }
    // A title that never offered two tracks is settled; only a failure or a shrink after a valid list is suspect.
    if (list && !this.known) {
      this.stopRecovery();
      return list;
    }
    this.recover();
    if (!this.known) return null;
    return { ...this.known, blocked: true, stale: true, tracks: this.known.tracks.map(track => ({ ...track, selected: false, disabled: true })) };
  }

  private forget(): void {
    this.known = null;
    this.title = null;
    this.stopRecovery();
  }

  private stopRecovery(): void {
    if (this.retry !== null) this.clock.clearTimeout(this.retry);
    this.retry = null;
    this.retryStep = 0;
  }

  private recover(): void {
    if (this.retry !== null || !this.listeners.size || this.doc.hidden) return;
    const delay = RECOVERY_DELAYS[Math.min(this.retryStep++, RECOVERY_DELAYS.length - 1)];
    this.retry = this.clock.setTimeout(() => {
      this.retry = null;
      this.notify();
    }, delay);
  }

  private readonly notify = () => {
    if (this.disposed) return;
    for (const listener of [...this.listeners]) listener();
  };

  /** Hidden documents retry nothing; coming back reads again. */
  private readonly visibility = () => {
    if (this.doc.hidden) this.stopRecovery();
    else this.notify();
  };

  /**
   * Asks MAIN to switch, then believes only the list it reads back: page scripts can forge the
   * answer event, and the title may have changed while Hive reloaded.
   */
  async selectAudioTrack(id: string, mediaId: string | null): Promise<boolean> {
    const view = this.view;
    if (this.disposed || !view || !mediaId || this.playId() !== mediaId) return false;
    // A retained list is never selectable: only a live read offers the track.
    const live = this.read();
    if (!live || !live.tracks.some(track => track.id === id)) return false;
    const video = this.video;
    // A pause the viewer chose: the title has played and stopped mid-way, not one still starting.
    const keepPaused = Boolean(video && video.paused && !video.ended && video.played.length > 0);
    const request: DisneyAudioSelect = { requestId: nextRequestId(), playId: mediaId, trackId: id, keepPaused };
    const ok = await new Promise<boolean>(resolve => {
      let timer = 0;
      const settle = (value: boolean) => {
        view.removeEventListener(DISNEY_AUDIO_RESULT, onResult);
        view.clearTimeout(timer);
        this.pending.delete(cancel);
        resolve(value);
      };
      const cancel = () => settle(false);
      const onResult = (event: Event) => {
        const result = parseDisneyAudioResult((event as CustomEvent<unknown>).detail);
        if (result?.requestId === request.requestId) settle(result.ok);
      };
      this.pending.add(cancel);
      view.addEventListener(DISNEY_AUDIO_RESULT, onResult);
      timer = view.setTimeout(cancel, ANSWER_TIMEOUT_MS);
      view.dispatchEvent(new CustomEvent(DISNEY_AUDIO_SELECT, { detail: JSON.stringify(request) }));
    });
    if (!ok || this.disposed || this.playId() !== mediaId) return false;
    const after = this.read();
    return after !== null && after.bindingId === live.bindingId && after.tracks.some(track => track.id === id && track.selected);
  }

  /** MAIN follows Hive's state store only while this lease is held; the cleanup releases it. */
  observeAudioTracks(onChange: () => void): () => void {
    const view = this.view;
    if (this.disposed || !view) return () => {};
    const watchId = nextRequestId();
    const lease = (on: boolean) => view.dispatchEvent(new CustomEvent(DISNEY_AUDIO_WATCH, { detail: JSON.stringify({ watchId, on }) }));
    view.addEventListener(DISNEY_AUDIO_CHANGE, onChange);
    this.listeners.add(onChange);
    if (this.listeners.size === 1) this.doc.addEventListener('visibilitychange', this.visibility);
    lease(true);
    let active = true;
    const release = () => {
      if (!active) return;
      active = false;
      this.releases.delete(release);
      view.removeEventListener(DISNEY_AUDIO_CHANGE, onChange);
      this.listeners.delete(onChange);
      if (!this.listeners.size) {
        this.doc.removeEventListener('visibilitychange', this.visibility);
        this.forget();
      }
      lease(false);
    };
    this.releases.add(release);
    return release;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const cancel of [...this.pending]) cancel();
    for (const release of [...this.releases]) release();
    this.forget();
  }
}
