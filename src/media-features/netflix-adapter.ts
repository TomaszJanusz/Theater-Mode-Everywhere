import {
  NETFLIX_CAPTION_ACK_EVENT,
  NETFLIX_CAPTION_EVENT,
  netflixCaptionRequestDetail,
  parseNetflixCaptionAck,
  readPublishedNetflixSnapshot,
  selectableNetflixTextTracks,
  selectNetflixCaptionTarget,
  type NetflixSnapshot,
  type NetflixTextTrack
} from './parsers/netflix-page';
import { NETFLIX_PREVIEW_EVENT, NETFLIX_PREVIEW_ID, parseNetflixPreviewFrame } from './parsers/netflix-preview';
import { netflixWatchId } from '../providers/netflix/session';
import { sanitizeContentTitle } from './content-title';
import type {
  CaptionActivationResult,
  CaptionTrack,
  MediaCapabilities,
  MediaFeaturesAdapter,
  PreviewSource,
  PreviewFrame
} from './types';

function toCaptionTrack(track: NetflixTextTrack): CaptionTrack {
  return {
    id: `netflix:${track.id}`,
    language: track.language,
    label: track.label,
    kind: track.kind,
    source: 'netflix',
    delivery: 'host'
  };
}

function bareTrackId(id: string): string {
  return id.startsWith('netflix:') ? id.slice('netflix:'.length) : id;
}

const NETFLIX_CAPTION_ACK_TIMEOUT_MS = 750;

type NetflixCaptionTarget = Pick<Window, 'addEventListener' | 'removeEventListener' | 'dispatchEvent' | 'setTimeout' | 'clearTimeout'>;

export function netflixCaptionRequestId(): string {
  return `te-nf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Isolated content and the page MAIN world cannot share a mutable object on
 * CustomEvent.detail. Firefox denies that crossing. Both sides pass a JSON string.
 */
export function requestNetflixHostCaption(
  trackId: string | null,
  target: NetflixCaptionTarget = window,
  timeoutMs = NETFLIX_CAPTION_ACK_TIMEOUT_MS,
  videoId?: string
): Promise<boolean> {
  const requestId = netflixCaptionRequestId();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      target.removeEventListener(NETFLIX_CAPTION_ACK_EVENT, onAck);
      target.clearTimeout(timer);
      resolve(ok);
    };
    const onAck = (event: Event) => {
      const ack = parseNetflixCaptionAck((event as CustomEvent<unknown>).detail);
      if (!ack || ack.requestId !== requestId) return;
      finish(ack.ok);
    };
    const timer = target.setTimeout(() => finish(false), timeoutMs);
    target.addEventListener(NETFLIX_CAPTION_ACK_EVENT, onAck);
    target.dispatchEvent(new CustomEvent(NETFLIX_CAPTION_EVENT, {
      detail: netflixCaptionRequestDetail({ requestId, trackId, videoId })
    }));
  });
}

export class NetflixAdapter implements MediaFeaturesAdapter {
  private previewVideoId: string | null = null;
  private previewCache = new Map<number, PreviewFrame>();
  private read(): NetflixSnapshot | null {
    const snapshot = readPublishedNetflixSnapshot();
    const watchId = typeof window === 'undefined' ? null : netflixWatchId(window.location?.pathname || '');
    return watchId && snapshot?.videoId !== watchId ? null : snapshot;
  }

  mediaId(): string | null {
    return this.read()?.videoId || null;
  }

  getTitle(): string | null {
    return sanitizeContentTitle(this.read()?.title) || null;
  }

  async probe(): Promise<MediaCapabilities> {
    const snapshot = this.read();
    const tracks = snapshot?.captions === false ? [] : selectableNetflixTextTracks(snapshot?.tracks || []);
    return { captions: tracks.length > 0, chapters: false, previews: snapshot?.previews === true };
  }

  async listCaptionTracks(): Promise<CaptionTrack[]> {
    const snapshot = this.read();
    if (snapshot?.captions === false) return [];
    return selectableNetflixTextTracks(snapshot?.tracks || []).map(toCaptionTrack);
  }

  async activateCaptionTrack(id: string | null): Promise<CaptionActivationResult> {
    if (id != null) {
      const snapshot = this.read();
      if (snapshot?.captions === false) return { status: 'failed', delivery: 'none', cues: [] };
      const target = selectNetflixCaptionTarget(snapshot?.tracks || [], bareTrackId(id));
      if (!target || target.none) return { status: 'failed', delivery: 'none', cues: [] };
      let ok = false;
      try {
        ok = await requestNetflixHostCaption(target.id, window, NETFLIX_CAPTION_ACK_TIMEOUT_MS, snapshot?.videoId);
      } catch {
        ok = false;
      }
      if (!ok) return { status: 'failed', delivery: 'none', cues: [] };
      return { status: 'active', delivery: 'host', cues: [] };
    }
    let ok = false;
    try {
      ok = await requestNetflixHostCaption(null, window, NETFLIX_CAPTION_ACK_TIMEOUT_MS, this.read()?.videoId);
    } catch {
      ok = false;
    }
    if (!ok) return { status: 'failed', delivery: 'none', cues: [] };
    return { status: 'off', delivery: 'none', cues: [] };
  }

  getChapters(): Promise<never[]> {
    return Promise.resolve([]);
  }

  async getPreviewSource(): Promise<PreviewSource> {
    return this.read()?.previews ? { kind: 'sprite', provider: 'netflix' } : { kind: 'none', reason: 'unsupported' };
  }

  getPreviewFrame(time: number, duration: number): PreviewFrame | null {
    const snapshot = this.read();
    if (!snapshot?.previews || !snapshot.videoId || !Number.isFinite(time) || time < 0) return null;
    if (this.previewVideoId !== snapshot.videoId) {
      this.previewCache.clear();
      this.previewVideoId = snapshot.videoId;
    }
    const target = Math.max(0, Math.floor(Math.min(time, duration || time) / 5) * 5);
    const cached = this.previewCache.get(target);
    if (cached) return cached;
    // The host returns an already decoded JPEG synchronously; only JSON strings
    // cross worlds, and no manifest, license, or subtitle download is requested.
    window.dispatchEvent(new CustomEvent(NETFLIX_PREVIEW_EVENT, { detail: JSON.stringify({ videoId: snapshot.videoId, time: target }) }));
    const frame = parseNetflixPreviewFrame(document.getElementById(NETFLIX_PREVIEW_ID)?.textContent, snapshot.videoId, target);
    if (frame) {
      this.previewCache.set(target, frame);
      if (this.previewCache.size > 24) this.previewCache.delete(this.previewCache.keys().next().value!);
    }
    return frame;
  }

  async reload(): Promise<void> {
    this.read();
  }

  invalidate(): void {
    this.previewVideoId = null;
    this.previewCache.clear();
  }

  dispose(): void {
    this.invalidate();
  }
}
