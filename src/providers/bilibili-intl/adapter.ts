import { sanitizeContentTitle } from '../../media-features/content-title';
import {
  bilibiliIntlPreviewFrame,
  mergeBilibiliIntlSnapshot,
  parseBilibiliIntlCaptions,
  type BilibiliIntlKind,
  type BilibiliIntlSnapshot
} from '../../media-features/parsers/bilibili-intl';
import { requestMediaProbe, requestPageFetch } from '../../media-features/probe';
import type { CaptionActivationResult, CaptionTrack, Chapter, MediaCapabilities, MediaFeaturesAdapter, PreviewSource } from '../../media-features/types';
import { bilibiliIntlIntegrationEnabled, bilibiliIntlLoadScope, bilibiliIntlPageId, type BilibiliIntlLoadScope } from './main';

const HOST_CAPTIONS_ATTR = 'data-te-bilibili-intl-captions-hidden';

/** Uploads must name `ugc`. An omitted kind is an older episode publication. */
function publishedKindAccepted(scopeKind: BilibiliIntlKind | null, snapshotKind: unknown): boolean {
  if (scopeKind === 'ugc') return snapshotKind === 'ugc';
  if (scopeKind === 'ogv') return snapshotKind === 'ogv' || snapshotKind == null;
  return false;
}

function storedSnapshot(scope: BilibiliIntlLoadScope, next: BilibiliIntlSnapshot): BilibiliIntlSnapshot | null {
  if (!publishedKindAccepted(scope.kind, next.kind)) return null;
  // Older episode publications omit kind and the later chapters field.
  const kind = next.kind === 'ugc' ? 'ugc' : 'ogv';
  const chapters = next.chapters ?? [];
  if (next.kind === kind && next.chapters === chapters) return next;
  return { ...next, kind, chapters };
}

export class BilibiliIntlAdapter implements MediaFeaturesAdapter {
  private snapshot: BilibiliIntlSnapshot | null = null;
  private snapshotPath: string | null = null;
  private pending: Promise<void> | null = null;
  private pendingFor: string | null = null;
  private loadGeneration = 0;
  private cueGeneration = 0;
  /** The next activate(null) is the controller cleanup after a failed attempt, so the host layer stays up. */
  private preserveHostFallback = false;

  private matchingSnapshot(): BilibiliIntlSnapshot | null {
    const scope = bilibiliIntlLoadScope();
    const pageId = scope.supported ? bilibiliIntlPageId() : null;
    const snapshot = this.snapshot;
    if (!pageId || !snapshot || snapshot.videoId !== pageId || this.snapshotPath !== scope.path) return null;
    if (!publishedKindAccepted(scope.kind, snapshot.kind)) return null;
    return snapshot;
  }

  private load(previous: BilibiliIntlSnapshot | null = null): Promise<void> {
    const scope = bilibiliIntlLoadScope();
    const pageId = scope.supported ? bilibiliIntlPageId() : null;
    if (pageId && this.snapshot?.videoId === pageId && this.snapshotPath === scope.path && publishedKindAccepted(scope.kind, this.snapshot.kind)) {
      return Promise.resolve();
    }
    if (!scope.supported) {
      this.loadGeneration++;
      this.snapshot = null;
      this.snapshotPath = null;
      this.pending = null;
      this.pendingFor = null;
      return Promise.resolve();
    }
    // A season URL has no episode segment, and the content world cannot see __initialState.
    // Probe anyway. Accept the id MAIN publishes, including when an older attribute was left behind.
    const scopeKey = `${scope.kind ?? ''}|${scope.path}|${scope.routeEpisodeId ?? ''}`;
    if (this.pending && this.pendingFor === scopeKey) return this.pending;
    this.snapshot = null;
    this.snapshotPath = null;
    if (this.pending) this.loadGeneration++;
    const generation = this.loadGeneration;
    const pending = requestMediaProbe(8000, 'bilibiliIntl').then((result) => {
      if (generation !== this.loadGeneration) return;
      const now = bilibiliIntlLoadScope();
      const next = result.bilibiliIntl ?? null;
      const currentId = now.supported ? bilibiliIntlPageId() : null;
      const samePage = now.supported && now.path === scope.path && now.routeEpisodeId === scope.routeEpisodeId;
      const identityMatches = Boolean(currentId && next && next.videoId === currentId);
      const routeMatches = !scope.routeEpisodeId || next?.videoId === scope.routeEpisodeId;
      const accepted = next && identityMatches ? storedSnapshot(now, next) : null;
      if (!samePage || !accepted || !routeMatches) {
        this.snapshot = null;
        this.snapshotPath = null;
        return;
      }
      const retained = previous?.videoId === currentId && publishedKindAccepted(now.kind, previous.kind) ? previous : null;
      this.snapshot = mergeBilibiliIntlSnapshot(retained, accepted);
      this.snapshotPath = scope.path;
    }).finally(() => {
      if (this.pending === pending) {
        this.pending = null;
        this.pendingFor = null;
      }
    });
    this.pending = pending;
    this.pendingFor = scopeKey;
    return pending;
  }

  async probe(): Promise<MediaCapabilities> {
    await this.load();
    const snapshot = this.matchingSnapshot();
    return {
      captions: Boolean(snapshot?.captionTracks.length),
      chapters: Boolean(snapshot?.chapters?.length),
      previews: Boolean(snapshot?.storyboard)
    };
  }

  async listCaptionTracks(): Promise<CaptionTrack[]> {
    await this.load();
    return (this.matchingSnapshot()?.captionTracks || []).map(({ id, language, label }) => ({
      id, language, label, kind: 'subtitles', source: 'bilibiliIntl', delivery: 'overlay'
    }));
  }

  async activateCaptionTrack(id: string | null): Promise<CaptionActivationResult> {
    if (id === null) {
      this.cueGeneration++;
      if (this.preserveHostFallback) {
        this.preserveHostFallback = false;
        this.hideHostCaptions(false);
        return { status: 'off', delivery: 'none', cues: [] };
      }
      this.hideHostCaptions(this.usableTracksOnPage());
      return { status: 'off', delivery: 'none', cues: [] };
    }
    // A newer selection must cancel an in-flight one before the first await.
    // Otherwise a late failure still matches the sampled generation and unhides host captions.
    this.cueGeneration++;
    const generation = this.cueGeneration;
    this.preserveHostFallback = false;
    await this.load();
    const failed = (): CaptionActivationResult => ({ status: 'failed', delivery: 'none', cues: [] });
    if (!this.operationCurrent(generation)) return failed();
    const snapshot = this.matchingSnapshot();
    const videoId = snapshot?.videoId ?? null;
    const track = videoId ? snapshot?.captionTracks.find((item) => item.id === id) : undefined;
    if (!track || !videoId) {
      this.keepHostFallback();
      return failed();
    }
    const body = await requestPageFetch(track.url);
    if (!this.operationCurrent(generation, videoId, id)) return failed();
    const cues = body ? parseBilibiliIntlCaptions(body) : [];
    if (!cues.length) {
      this.keepHostFallback();
      return failed();
    }
    this.preserveHostFallback = false;
    this.hideHostCaptions(true);
    return { status: 'active', delivery: 'overlay', cues };
  }

  async getPreviewSource(): Promise<PreviewSource> {
    await this.load();
    return this.matchingSnapshot()?.storyboard ? { kind: 'sprite', provider: 'bilibiliIntl' } : { kind: 'none', reason: 'no-bilibili-intl-preview' };
  }

  getPreviewFrame(time: number) {
    const storyboard = this.matchingSnapshot()?.storyboard;
    return storyboard ? bilibiliIntlPreviewFrame(storyboard, time) : null;
  }

  mediaId() {
    const snapshot = this.matchingSnapshot();
    if (!snapshot) return null;
    return `${snapshot.kind === 'ugc' ? 'ugc' : 'ogv'}:${snapshot.videoId}`;
  }
  getTitle() { return sanitizeContentTitle(this.matchingSnapshot()?.title); }

  async getChapters(): Promise<Chapter[]> {
    await this.load();
    return (this.matchingSnapshot()?.chapters || []).map((chapter) => ({
      start: chapter.start,
      end: chapter.end,
      title: chapter.title,
      source: 'bilibiliIntl',
      confidence: 'high'
    }));
  }

  private usableTracksOnPage(): boolean {
    return Boolean(bilibiliIntlIntegrationEnabled() && this.matchingSnapshot()?.captionTracks.length);
  }

  /** Generation is incremented before the first await. After the body fetch, the page scope and track must still match. */
  private operationCurrent(generation: number, videoId?: string, id?: string): boolean {
    if (generation !== this.cueGeneration || !bilibiliIntlIntegrationEnabled()) return false;
    if (!videoId) return true;
    const snapshot = this.matchingSnapshot();
    return snapshot?.videoId === videoId
      && Boolean(snapshot.captionTracks.some((item) => item.id === id));
  }

  private keepHostFallback(): void {
    this.preserveHostFallback = true;
    this.hideHostCaptions(false);
  }

  private hideHostCaptions(hidden: boolean): void {
    document.documentElement?.toggleAttribute(HOST_CAPTIONS_ATTR, hidden);
  }

  invalidate(): void {
    this.loadGeneration++;
    this.cueGeneration++;
    this.preserveHostFallback = false;
    this.snapshot = null;
    this.snapshotPath = null;
    this.pending = null;
    this.pendingFor = null;
    this.hideHostCaptions(false);
  }

  async reload(): Promise<void> {
    const previous = this.snapshot;
    this.loadGeneration++;
    this.cueGeneration++;
    this.preserveHostFallback = false;
    this.snapshot = null;
    this.snapshotPath = null;
    this.pending = null;
    this.pendingFor = null;
    await this.load(previous);
  }

  dispose(): void { this.invalidate(); }
}
