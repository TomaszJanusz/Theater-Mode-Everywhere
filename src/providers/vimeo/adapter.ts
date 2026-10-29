import { sanitizeContentTitle } from '../../media-features/content-title';
import type { MediaProbeSnapshot } from '../../media-features/probe';
import type {
  CaptionActivationResult,
  CaptionTrack,
  Chapter,
  MediaCapabilities,
  MediaFeaturesAdapter,
  PreviewFrame,
  PreviewSource
} from '../../media-features/types';

import { normalizeVimeoSnapshot, type VimeoPlayerSnapshot } from './snapshot-model';
import { getVimeoPreviewFrame, parseVimeoThumbPreview, type VimeoThumbSprite } from './thumbs';

/** The isolated runtime's shared probe owner, lent by the registry so the provider bundles no second copy. */
export type VimeoServices = {
  requestMediaProbe(): Promise<MediaProbeSnapshot>;
};

export class VimeoAdapter implements MediaFeaturesAdapter {
  private snapshot: VimeoPlayerSnapshot | null = null;
  private thumbs: VimeoThumbSprite | null = null;

  constructor(private readonly services: VimeoServices) {}

  async load(): Promise<void> {
    const probed = await this.services.requestMediaProbe();
    this.snapshot = normalizeVimeoSnapshot(probed.providers?.vimeo);
    this.thumbs = parseVimeoThumbPreview(this.snapshot?.thumbPreview, this.snapshot?.duration || 0);
  }

  async probe(): Promise<MediaCapabilities> {
    if (!this.snapshot) await this.load();
    const chapters = this.snapshot?.chapters || [];
    return {
      captions: false,
      chapters: chapters.length > 0,
      previews: Boolean(this.thumbs)
    };
  }

  async listCaptionTracks(): Promise<CaptionTrack[]> {
    return [];
  }

  async activateCaptionTrack(id: string | null): Promise<CaptionActivationResult> {
    // Vimeo Player SDK cue events are consumed in MAIN world when available.
    // Overlay rendering is handled through native tracks if the embed exposes them.
    return id === null
      ? { status: 'off', delivery: 'none', cues: [] }
      : { status: 'failed', delivery: 'none', cues: [] };
  }

  async getChapters(): Promise<Chapter[]> {
    if (!this.snapshot) await this.load();
    const chapters = this.snapshot?.chapters || [];
    const duration = this.snapshot?.duration;
    return chapters
      .filter((chapter) => typeof chapter.startTime === 'number' && chapter.title)
      .sort((a, b) => (a.startTime || 0) - (b.startTime || 0))
      .map((chapter, index, all) => ({
        start: chapter.startTime || 0,
        end: all[index + 1]?.startTime ?? duration,
        title: String(chapter.title),
        source: 'vimeo',
        confidence: 'high' as const
      }));
  }

  async getPreviewSource(): Promise<PreviewSource> {
    if (!this.snapshot) await this.load();
    return this.thumbs
      ? { kind: 'sprite', provider: 'vimeo' }
      : { kind: 'none', reason: 'no-thumb-preview' };
  }

  getPreviewFrame(time: number, duration: number): PreviewFrame | null {
    if (!this.thumbs) return null;
    return getVimeoPreviewFrame(this.thumbs, time, duration || this.thumbs.duration);
  }

  mediaId(): string | null {
    return this.snapshot?.videoId || null;
  }

  getTitle(): string | null {
    return sanitizeContentTitle(this.snapshot?.title);
  }

  async reload(): Promise<void> {
    this.snapshot = null;
    this.thumbs = null;
    await this.load();
  }

  invalidate(): void {
    this.snapshot = null;
    this.thumbs = null;
  }

  dispose(): void {
    this.snapshot = null;
    this.thumbs = null;
  }
}
