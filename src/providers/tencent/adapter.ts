import { requestMediaProbe } from '../../media-features/probe';
import type { CaptionActivationResult, MediaFeaturesAdapter } from '../../media-features/types';
import type { TencentSnapshot } from './main';

/** Tencent's HTML5 text tracks are handled by NativeTextTrackAdapter. */
export class TencentAdapter implements MediaFeaturesAdapter {
  private snapshot: TencentSnapshot | null = null;
  private generation = 0;
  async probe() {
    const generation = this.generation;
    const result = await requestMediaProbe();
    if (generation === this.generation) this.snapshot = result.tencent || null;
    return { captions: false, chapters: false, previews: false };
  }
  async listCaptionTracks() { return []; }
  async activateCaptionTrack(id: string | null): Promise<CaptionActivationResult> {
    return { status: id === null ? 'off' : 'failed', delivery: 'none', cues: [] };
  }
  mediaId() { return this.snapshot?.videoId || null; }
  getTitle() { return this.snapshot?.title || null; }
  invalidate(): void { this.generation++; this.snapshot = null; }
  async reload(): Promise<void> { this.invalidate(); await this.probe(); }
  dispose(): void { this.invalidate(); }
}
