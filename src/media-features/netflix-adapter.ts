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
import { sanitizeContentTitle } from './content-title';
import type {
  CaptionActivationResult,
  CaptionTrack,
  MediaCapabilities,
  MediaFeaturesAdapter,
  PreviewSource
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
  timeoutMs = NETFLIX_CAPTION_ACK_TIMEOUT_MS
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
      detail: netflixCaptionRequestDetail({ requestId, trackId })
    }));
  });
}

export class NetflixAdapter implements MediaFeaturesAdapter {
  private read(): NetflixSnapshot | null {
    return readPublishedNetflixSnapshot();
  }

  mediaId(): string | null {
    return this.read()?.videoId || null;
  }

  getTitle(): string | null {
    return sanitizeContentTitle(this.read()?.title) || null;
  }

  async probe(): Promise<MediaCapabilities> {
    const tracks = selectableNetflixTextTracks(this.read()?.tracks || []);
    return { captions: tracks.length > 0, chapters: false, previews: false };
  }

  async listCaptionTracks(): Promise<CaptionTrack[]> {
    return selectableNetflixTextTracks(this.read()?.tracks || []).map(toCaptionTrack);
  }

  async activateCaptionTrack(id: string | null): Promise<CaptionActivationResult> {
    const tracks = this.read()?.tracks || [];
    const target = selectNetflixCaptionTarget(tracks, id == null ? null : bareTrackId(id));
    if (!target) return { status: 'failed', delivery: 'none', cues: [] };
    const trackId = target.none ? null : target.id;
    let ok = false;
    try {
      ok = await requestNetflixHostCaption(trackId);
    } catch {
      ok = false;
    }
    if (!ok) return { status: 'failed', delivery: 'none', cues: [] };
    if (trackId == null) return { status: 'off', delivery: 'none', cues: [] };
    return { status: 'active', delivery: 'host', cues: [] };
  }

  getChapters(): Promise<never[]> {
    return Promise.resolve([]);
  }

  async getPreviewSource(): Promise<PreviewSource> {
    return { kind: 'none', reason: 'unsupported' };
  }

  async reload(): Promise<void> {
    this.read();
  }

  invalidate(): void {}

  dispose(): void {
    this.invalidate();
  }
}
