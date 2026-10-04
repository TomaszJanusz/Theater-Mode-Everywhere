import { parseCaptionPayload } from '../../media-features/parsers/captions';
import { tencentPreviewFrame, type TencentSnapshot } from '../../media-features/parsers/tencent';
import { requestMediaProbe, requestPageFetch } from '../../media-features/probe';
import type { CaptionActivationResult, CaptionTrack, MediaCapabilities, MediaFeaturesAdapter, PreviewSource } from '../../media-features/types';
import { tencentIntegrationEnabled, tencentPageVideoId } from './main';

export class TencentAdapter implements MediaFeaturesAdapter {
  private snapshot: TencentSnapshot | null = null;
  private pending: Promise<void> | null = null;
  private generation = 0;

  private load(): Promise<void> {
    if (this.snapshot && this.snapshot.videoId === tencentPageVideoId()) return Promise.resolve();
    this.snapshot = null;
    if (this.pending) return this.pending;
    const generation = this.generation;
    const pending = requestMediaProbe().then((result) => {
      if (generation === this.generation && result.tencent?.videoId === tencentPageVideoId()) this.snapshot = result.tencent;
    }).finally(() => { if (this.pending === pending) this.pending = null; });
    this.pending = pending;
    return pending;
  }

  async probe(): Promise<MediaCapabilities> {
    await this.load();
    return { captions: Boolean(this.snapshot?.captionTracks.length), chapters: false, previews: Boolean(this.snapshot?.storyboard) };
  }

  async listCaptionTracks(): Promise<CaptionTrack[]> {
    await this.load();
    return (this.snapshot?.captionTracks || []).map(({ id, language, label }) => ({
      id, language, label, kind: 'subtitles', source: 'tencent', delivery: 'overlay'
    }));
  }

  async activateCaptionTrack(id: string | null): Promise<CaptionActivationResult> {
    await this.load();
    if (id === null) {
      this.hideHostCaptions(Boolean(this.snapshot?.captionTracks.length));
      return { status: 'off', delivery: 'none', cues: [] };
    }
    const track = this.snapshot?.captionTracks.find((item) => item.id === id);
    const generation = this.generation;
    const videoId = this.snapshot?.videoId;
    const body = track ? await requestPageFetch(track.url) : null;
    const current = generation === this.generation && videoId === tencentPageVideoId() && tencentIntegrationEnabled();
    const cues = body && current ? parseCaptionPayload(body) : [];
    if (!cues.length) return { status: 'failed', delivery: 'none', cues: [] };
    this.hideHostCaptions(true);
    return { status: 'active', delivery: 'overlay', cues };
  }

  async getPreviewSource(): Promise<PreviewSource> {
    await this.load();
    return this.snapshot?.storyboard ? { kind: 'sprite', provider: 'tencent' } : { kind: 'none', reason: 'no-tencent-preview' };
  }
  getPreviewFrame(time: number) {
    return this.snapshot?.storyboard && this.snapshot.videoId === tencentPageVideoId() ? tencentPreviewFrame(this.snapshot.storyboard, time) : null;
  }
  mediaId() { return this.snapshot?.videoId || null; }
  getTitle() { return this.snapshot?.videoId === tencentPageVideoId() ? this.snapshot?.title || null : null; }
  private hideHostCaptions(hidden: boolean): void {
    document.documentElement.toggleAttribute('data-te-tencent-captions-hidden', hidden);
  }
  invalidate(): void { this.generation++; this.snapshot = null; this.pending = null; this.hideHostCaptions(false); }
  async reload(): Promise<void> { this.invalidate(); await this.load(); }
  dispose(): void { this.invalidate(); }
}
