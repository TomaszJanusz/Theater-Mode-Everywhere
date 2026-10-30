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

/**
 * Disney+ audio tracks for the theater, beside the legacy Disney adapter that owns captions,
 * previews and the title. Every read goes to MAIN, since Hive switches tracks itself.
 */
export class DisneyAudioAdapter implements MediaFeaturesAdapter {
  private disposed = false;
  /** Settles every unanswered selection as refused on disposal. */
  private readonly pending = new Set<() => void>();
  private readonly releases = new Set<() => void>();

  constructor(private readonly video: HTMLVideoElement | null, private readonly doc: Document = document) {}

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
  listAudioTracks(): AudioTrackList | null {
    const view = this.view;
    const playId = this.playId();
    if (this.disposed || !view || !playId) return null;
    const requestId = nextRequestId();
    const pageHref = view.location.href;
    view.dispatchEvent(new CustomEvent(DISNEY_AUDIO_QUERY, { detail: requestId }));
    const snapshot = parseDisneyAudioSnapshot(this.doc.getElementById(DISNEY_AUDIO_SNAPSHOT)?.textContent, requestId, pageHref);
    if (!snapshot || snapshot.playId !== playId) return null;
    // Ads are not known to change this list; the Hive interstitial state was empty when it was read.
    return { mediaId: playId, tracks: disneyAudioTracks(snapshot.tracks), blocked: false };
  }

  /**
   * Asks MAIN to switch, then believes only the list it reads back: page scripts can forge the
   * answer event, and the title may have changed while Hive reloaded.
   */
  async selectAudioTrack(id: string, mediaId: string | null): Promise<boolean> {
    const view = this.view;
    if (this.disposed || !view || !mediaId || this.playId() !== mediaId) return false;
    if (!this.listAudioTracks()?.tracks.some(track => track.id === id)) return false;
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
    return this.listAudioTracks()?.tracks.some(track => track.id === id && track.selected) === true;
  }

  /** MAIN follows Hive's state store only while this lease is held; the cleanup releases it. */
  observeAudioTracks(onChange: () => void): () => void {
    const view = this.view;
    if (this.disposed || !view) return () => {};
    const watchId = nextRequestId();
    const lease = (on: boolean) => view.dispatchEvent(new CustomEvent(DISNEY_AUDIO_WATCH, { detail: JSON.stringify({ watchId, on }) }));
    view.addEventListener(DISNEY_AUDIO_CHANGE, onChange);
    lease(true);
    let active = true;
    const release = () => {
      if (!active) return;
      active = false;
      this.releases.delete(release);
      view.removeEventListener(DISNEY_AUDIO_CHANGE, onChange);
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
  }
}
