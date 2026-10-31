import { mediaProviderIntegrationEnabled } from '../../media-features/provider-flags';
import type { AudioTrackList } from '../../media-features/types';

import {
  AUDIO_ACK, AUDIO_CHANGE, AUDIO_QUERY, AUDIO_SELECT, AUDIO_SNAPSHOT, AUDIO_STOP, AUDIO_TIMEOUT,
  parseAudioAck, parseAudioSnapshot, type AudioRequest, type AudioSelect, type AudioSnapshot
} from './audio-bridge';
import { findNetflixPlayerRoot, netflixWatchId } from './session';

let counter = 0;
const nextId = () => `nf:${++counter}`;

export type AudioRecoveryClock = { setTimeout(callback: () => void, ms: number): number; clearTimeout(id: number): void };
const recoveryDelays = [250, 500, 1000, 2000, 5000];

/** A theater adapter owns its bridge subscription and all commands, including their deadlines. */
export class NetflixAudioClient {
  private readonly clientId = nextId();
  private readonly listeners = new Set<() => void>();
  private readonly pending = new Set<() => void>();
  private disposed = false;
  private stopFlags = () => {};
  private known: AudioTrackList | null = null;
  private title: string | null = null;
  private retry: number | null = null;
  private retryStep = 0;
  private suspended = false;
  private queued = false;

  constructor(private video: HTMLVideoElement | null, private readonly clock: AudioRecoveryClock = {
    setTimeout: (callback, ms) => window.setTimeout(callback, ms), clearTimeout: id => window.clearTimeout(id)
  }) {}

  private request(): AudioRequest | null {
    const mediaId = netflixWatchId(window.location.pathname);
    const root = findNetflixPlayerRoot(document);
    if (!this.video?.isConnected || !root?.contains(this.video)) this.video = root?.querySelector('video') ?? this.video;
    return !this.disposed && !this.suspended && this.video?.isConnected && mediaId && mediaProviderIntegrationEnabled('netflix')
      ? { requestId: nextId(), clientId: this.clientId, pageHref: window.location.href, mediaId } : null;
  }

  private snapshot(): AudioSnapshot | null {
    const request = this.request();
    if (!request) return null;
    this.video!.dispatchEvent(new CustomEvent(AUDIO_QUERY, { bubbles: true, detail: JSON.stringify({ ...request, observe: this.listeners.size > 0 }) }));
    return parseAudioSnapshot(document.getElementById(AUDIO_SNAPSHOT)?.textContent, request);
  }

  list(): AudioTrackList | null {
    const mediaId = netflixWatchId(window.location.pathname);
    if (this.disposed || !mediaProviderIntegrationEnabled('netflix')) {
      this.known = null; this.title = null; this.stopRecovery();
      return null;
    }
    // URL watch id is title knowledge; a temporarily absent API/element is not a new title.
    if (mediaId !== this.title) { this.known = null; this.title = mediaId; this.stopRecovery(); }
    // Outside /watch there is no title to recover; navigation discovery reports the next one.
    if (!mediaId) return null;
    const snapshot = this.snapshot();
    const list = snapshot?.list;
    if (list && !list.blocked && list.tracks.length >= 2) {
      this.known = { ...list, bindingId: snapshot.bindingId };
      this.stopRecovery();
      return this.known;
    }
    // A title that really offers one track is settled; only a shrink after a valid list is suspect.
    if (list && !list.blocked && !this.known) { this.stopRecovery(); return { ...list, bindingId: snapshot.bindingId }; }
    this.recover();
    if (this.known) return {
      ...this.known, blocked: true, stale: true,
      tracks: this.known.tracks.map(track => ({ ...track, selected: false, disabled: true }))
    };
    return { mediaId, tracks: [], blocked: true };
  }

  private stopRecovery(): void {
    if (this.retry !== null) this.clock.clearTimeout(this.retry);
    this.retry = null; this.retryStep = 0;
  }

  private recover(): void {
    if (this.retry !== null || !this.listeners.size || this.suspended || document.hidden) return;
    const delay = recoveryDelays[Math.min(this.retryStep++, recoveryDelays.length - 1)];
    this.retry = this.clock.setTimeout(() => { this.retry = null; this.changed(); }, delay);
  }

  private readonly visibility = () => {
    if (document.hidden) this.stopRecovery();
    else this.changed();
  };
  private readonly hide = (event: PageTransitionEvent) => {
    if (!event.persisted) { this.dispose(); return; }
    this.suspended = true;
    this.invalidate();
    this.changed();
  };
  private readonly show = () => { this.suspended = false; this.changed(); };

  async select(trackId: string, mediaId: string | null): Promise<boolean> {
    if (this.list()?.stale) return false;
    const snapshot = this.snapshot();
    if (!snapshot?.list || snapshot.mediaId !== mediaId || snapshot.list.blocked || !snapshot.list.tracks.some(track => track.id === trackId)) return false;
    // A newer choice cancels confirmation of an earlier one; it never calls the host again.
    this.cancel();
    const { clientId, pageHref, bindingId } = snapshot;
    const request: AudioSelect = { clientId, pageHref, bindingId, mediaId, requestId: nextId(), trackId };
    return new Promise(resolve => {
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        window.removeEventListener(AUDIO_ACK, ack);
        this.pending.delete(cancel);
        resolve(ok);
      };
      const cancel = () => finish(false);
      const ack = (event: Event) => {
        const result = parseAudioAck((event as CustomEvent<unknown>).detail, request);
        if (!result) return;
        const current = this.snapshot();
        finish(result.ok && current?.bindingId === request.bindingId && current.list?.blocked === false
          && current.list.tracks.some(track => track.id === trackId && track.selected));
      };
      const timer = window.setTimeout(cancel, AUDIO_TIMEOUT + 250);
      this.pending.add(cancel);
      window.addEventListener(AUDIO_ACK, ack);
      this.video!.dispatchEvent(new CustomEvent(AUDIO_SELECT, { bubbles: true, detail: JSON.stringify(request) }));
    });
  }

  private cancel(): void { for (const cancel of [...this.pending]) cancel(); }

  private readonly changed = () => {
    if (this.queued || this.disposed) return;
    this.queued = true;
    queueMicrotask(() => {
      this.queued = false;
      if (!this.disposed) for (const listener of this.listeners) listener();
    });
  };

  observe(onChange: () => void): () => void {
    if (this.disposed) return () => {};
    this.listeners.add(onChange);
    if (this.listeners.size === 1) {
      window.addEventListener(AUDIO_CHANGE, this.changed);
      document.addEventListener('visibilitychange', this.visibility);
      window.addEventListener('pagehide', this.hide);
      window.addEventListener('pageshow', this.show);
      const flags = new MutationObserver(() => {
        if (!mediaProviderIntegrationEnabled('netflix')) {
          const listeners = [...this.listeners];
          this.dispose();
          for (const listener of listeners) listener();
        } else this.changed();
      });
      flags.observe(document.documentElement, { attributes: true, attributeFilter: ['data-te-netflix-integration-off'] });
      this.stopFlags = () => flags.disconnect();
    }
    this.list();
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.listeners.delete(onChange);
      if (!this.listeners.size) {
        this.stopObservation();
        this.known = null; this.title = null;
        this.invalidate();
      }
    };
  }

  private stopObservation(): void {
    window.removeEventListener(AUDIO_CHANGE, this.changed);
    document.removeEventListener('visibilitychange', this.visibility);
    window.removeEventListener('pagehide', this.hide);
    window.removeEventListener('pageshow', this.show);
    this.stopFlags();
  }

  invalidate(): void {
    this.stopRecovery();
    this.cancel();
    window.dispatchEvent(new CustomEvent(AUDIO_STOP, { detail: this.clientId }));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopObservation();
    this.known = null; this.title = null;
    this.listeners.clear();
    this.invalidate();
  }
}
