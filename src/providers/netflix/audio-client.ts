import { mediaProviderIntegrationEnabled } from '../../media-features/provider-flags';
import type { AudioTrackList } from '../../media-features/types';

import {
  AUDIO_ACK, AUDIO_CHANGE, AUDIO_QUERY, AUDIO_SELECT, AUDIO_SNAPSHOT, AUDIO_STOP, AUDIO_TIMEOUT,
  parseAudioAck, parseAudioSnapshot, type AudioRequest, type AudioSelect, type AudioSnapshot
} from './audio-bridge';
import { netflixWatchId } from './session';

let counter = 0;
const nextId = () => `nf:${++counter}`;

/** A theater adapter owns its bridge subscription and all commands, including their deadlines. */
export class NetflixAudioClient {
  private readonly clientId = nextId();
  private readonly listeners = new Set<() => void>();
  private readonly pending = new Set<() => void>();
  private disposed = false;
  private stopFlags = () => {};

  constructor(private readonly video: HTMLVideoElement | null) {}

  private request(): AudioRequest | null {
    const mediaId = netflixWatchId(window.location.pathname);
    return !this.disposed && this.video?.isConnected && mediaId && mediaProviderIntegrationEnabled('netflix')
      ? { requestId: nextId(), clientId: this.clientId, pageHref: window.location.href, mediaId } : null;
  }

  private snapshot(): AudioSnapshot | null {
    const request = this.request();
    if (!request) return null;
    this.video!.dispatchEvent(new CustomEvent(AUDIO_QUERY, { bubbles: true, detail: JSON.stringify({ ...request, observe: this.listeners.size > 0 }) }));
    return parseAudioSnapshot(document.getElementById(AUDIO_SNAPSHOT)?.textContent, request);
  }

  list(): AudioTrackList | null { return this.snapshot()?.list ?? null; }

  async select(trackId: string, mediaId: string | null): Promise<boolean> {
    const snapshot = this.snapshot();
    if (!snapshot?.list || snapshot.mediaId !== mediaId || snapshot.list.blocked || !snapshot.list.tracks.some(track => track.id === trackId)) return false;
    // A newer choice cancels confirmation of an earlier one; it never calls the host again.
    this.cancel();
    const { clientId, pageHref, bindingId } = snapshot;
    const request: AudioSelect = { clientId, pageHref, bindingId, mediaId, requestId: nextId(), trackId };
    return new Promise(resolve => {
      const finish = (ok: boolean) => {
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
    for (const listener of this.listeners) listener();
  };

  observe(onChange: () => void): () => void {
    if (this.disposed) return () => {};
    this.listeners.add(onChange);
    if (this.listeners.size === 1) {
      window.addEventListener(AUDIO_CHANGE, this.changed);
      const flags = new MutationObserver(() => {
        if (!mediaProviderIntegrationEnabled('netflix')) this.invalidate();
        this.changed();
      });
      flags.observe(document.documentElement, { attributes: true, attributeFilter: ['data-te-netflix-integration-off'] });
      this.stopFlags = () => flags.disconnect();
    }
    this.snapshot();
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.listeners.delete(onChange);
      if (!this.listeners.size) {
        window.removeEventListener(AUDIO_CHANGE, this.changed);
        this.stopFlags();
        this.invalidate();
      }
    };
  }

  invalidate(): void {
    this.cancel();
    window.dispatchEvent(new CustomEvent(AUDIO_STOP, { detail: this.clientId }));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener(AUDIO_CHANGE, this.changed);
    this.stopFlags();
    this.listeners.clear();
    this.invalidate();
  }
}
