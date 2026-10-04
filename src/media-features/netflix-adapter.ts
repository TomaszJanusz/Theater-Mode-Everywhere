import {
  NETFLIX_CAPTION_EVENT,
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
    if (id != null && !target) return { status: 'failed', delivery: 'none', cues: [] };
    const detail: { trackId: string | null; ok: boolean } = { trackId: target?.id || null, ok: false };
    try {
      window.dispatchEvent(new CustomEvent(NETFLIX_CAPTION_EVENT, { detail }));
    } catch {
      return { status: 'failed', delivery: 'none', cues: [] };
    }
    if (!detail.ok) return { status: 'failed', delivery: 'none', cues: [] };
    if (id == null) return { status: 'off', delivery: 'none', cues: [] };
    return { status: 'active', delivery: 'host', cues: [] };
  }

  getChapters(): Promise<never[]> {
    return Promise.resolve([]);
  }

  async getPreviewSource(): Promise<PreviewSource> {
    return { kind: 'none', reason: 'not-provided' };
  }

  async reload(): Promise<void> {
    this.read();
  }

  invalidate(): void {}

  dispose(): void {
    this.invalidate();
  }
}
