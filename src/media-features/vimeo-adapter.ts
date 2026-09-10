import { requestMediaProbe, type VimeoPlayerSnapshot } from './probe';
import type {
  CaptionCue,
  CaptionTrack,
  Chapter,
  MediaCapabilities,
  MediaFeaturesAdapter
} from './types';

export class VimeoAdapter implements MediaFeaturesAdapter {
  private snapshot: VimeoPlayerSnapshot | null = null;

  async load(): Promise<void> {
    const probed = await requestMediaProbe();
    this.snapshot = probed.vimeo || null;
  }

  async probe(): Promise<MediaCapabilities> {
    if (!this.snapshot) await this.load();
    const chapters = this.snapshot?.chapters || [];
    return {
      captions: false,
      chapters: chapters.length > 0,
      previews: false
    };
  }

  async listCaptionTracks(): Promise<CaptionTrack[]> {
    return [];
  }

  async activateCaptionTrack(_id: string | null): Promise<CaptionCue[] | null> {
    // Vimeo Player SDK cue events are consumed in MAIN world when available.
    // Overlay rendering is handled through native tracks if the embed exposes them.
    return null;
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

  dispose(): void {
    this.snapshot = null;
  }
}

export function isVimeoHost(hostname = window.location.hostname): boolean {
  const host = hostname.replace(/^www\./, '');
  return host === 'vimeo.com' || host.endsWith('.vimeo.com');
}
