import { MAX_CRUNCHYROLL_BIF_BYTES, parseCrunchyrollCaptionBody, type CrunchyrollSnapshot } from '../../media-features/parsers/crunchyroll';
import {
  CRUNCHYROLL_CAPTION_ACK_EVENT,
  CRUNCHYROLL_CAPTION_EVENT,
  crunchyrollCaptionRequestDetail,
  crunchyrollCaptionRequestId,
  parseCrunchyrollCaptionAck
} from '../../media-features/parsers/crunchyroll';
import { parseRokuBif, type DisneyBifSet } from '../../media-features/parsers/disney-page';
import { requestMediaProbe, requestPageFetch } from '../../media-features/probe';
import type { CaptionActivationResult, CaptionTrack, Chapter, MediaCapabilities, MediaFeaturesAdapter, PreviewFrame, PreviewSource } from '../../media-features/types';
import { CRUNCHYROLL_HOST_CAPTION_CLASS, releaseCrunchyrollHostCaptionSurface, retainCrunchyrollHostCaptionSurface } from './host-surface';
import {
  CRUNCHYROLL_CAPTION_ACK_TIMEOUT_MS,
  crunchyrollIntegrationEnabled,
  crunchyrollPageMediaId,
  crunchyrollPageRoute
} from './main';

const CAPTION_ACK_TIMEOUT_MS = CRUNCHYROLL_CAPTION_ACK_TIMEOUT_MS;

type CaptionTarget = Pick<Window, 'addEventListener' | 'removeEventListener' | 'dispatchEvent' | 'setTimeout' | 'clearTimeout'>;

export function requestCrunchyrollHostCaption(
  mediaId: string,
  route: string,
  trackId: string | null,
  target: CaptionTarget = window,
  timeoutMs = CAPTION_ACK_TIMEOUT_MS
): Promise<boolean> {
  const requestId = crunchyrollCaptionRequestId();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      target.removeEventListener(CRUNCHYROLL_CAPTION_ACK_EVENT, onAck);
      target.clearTimeout(timer);
      resolve(ok);
    };
    const onAck = (event: Event) => {
      const ack = parseCrunchyrollCaptionAck((event as CustomEvent<unknown>).detail);
      if (!ack || ack.requestId !== requestId) return;
      const current = crunchyrollIntegrationEnabled()
        && crunchyrollPageMediaId() === mediaId
        && crunchyrollPageRoute() === route
        && ack.ok
        && ack.mediaId === mediaId
        && ack.route === route
        && ack.trackId === trackId;
      finish(current);
    };
    const timer = target.setTimeout(() => finish(false), timeoutMs);
    target.addEventListener(CRUNCHYROLL_CAPTION_ACK_EVENT, onAck);
    target.dispatchEvent(new CustomEvent(CRUNCHYROLL_CAPTION_EVENT, {
      detail: crunchyrollCaptionRequestDetail({ requestId, mediaId, route, trackId })
    }));
  });
}

export class CrunchyrollAdapter implements MediaFeaturesAdapter {
  private snapshot: CrunchyrollSnapshot | null = null;
  private route = '';
  private pending: Promise<void> | null = null;
  private loadGeneration = 0;
  private cueGeneration = 0;
  private bif: DisneyBifSet | null = null;
  private bifFailed = false;
  private bifLoad: Promise<void> | null = null;
  private bifLoadUrl = '';
  private bifSource = '';
  private previewBlob: string | null = null;
  private hostLift: { mediaId: string; route: string; trackId: string } | null = null;
  /** Host media still on this page when invalidate cleared the snapshot before Off. */
  private hostOffTarget: { mediaId: string; route: string } | null = null;

  private reconcileHostLift(snapshot: CrunchyrollSnapshot | null, live: boolean): void {
    const eligible = Boolean(
      snapshot
      && (snapshot.rendition === 'host' || snapshot.rendition === 'clean')
      && snapshot.hostTracks.length > 0
    );
    const playerOn = eligible && snapshot?.hostRenderer === 'active';
    const owned = Boolean(
      eligible
      && this.hostLift
      && snapshot
      && this.hostLift.mediaId === snapshot.mediaId
      && this.hostLift.route === this.route
      && snapshot.hostTracks.some((track) => track.id === this.hostLift?.trackId)
    );
    if (playerOn || (!live && owned)) {
      if (live && this.hostLift && !owned) this.hostLift = null;
      retainCrunchyrollHostCaptionSurface();
      return;
    }
    this.hostLift = null;
    releaseCrunchyrollHostCaptionSurface();
  }

  private load(): Promise<void> {
    const generation = this.loadGeneration;
    const route = crunchyrollPageRoute();
    const mediaId = crunchyrollIntegrationEnabled() ? crunchyrollPageMediaId() : null;
    if (!mediaId) {
      this.snapshot = null;
      this.route = route;
      this.bif = null;
      this.bifFailed = false;
      this.bifSource = '';
      this.hostLift = null;
      releaseCrunchyrollHostCaptionSurface();
      return Promise.resolve();
    }
    if (this.snapshot?.mediaId === mediaId && this.route === route && this.pending === null) {
      this.reconcileHostLift(this.snapshot, false);
      void this.ensureBif();
      return Promise.resolve();
    }
    if (this.pending) return this.pending;
    const pending = requestMediaProbe().then((result) => {
      if (generation !== this.loadGeneration || !crunchyrollIntegrationEnabled()) return;
      if (crunchyrollPageRoute() !== route || crunchyrollPageMediaId() !== mediaId) return;
      const next = result.crunchyroll;
      if (!next || next.mediaId !== mediaId) {
        this.snapshot = null;
        this.hostLift = null;
        releaseCrunchyrollHostCaptionSurface();
        return;
      }
      if (next.bifBlobUrl !== this.bifSource) {
        this.bif = null;
        this.bifFailed = false;
        this.bifSource = '';
      }
      this.snapshot = next;
      this.route = route;
      this.reconcileHostLift(next, true);
      void this.ensureBif();
    }).finally(() => {
      if (this.pending === pending) this.pending = null;
    });
    this.pending = pending;
    return pending;
  }

  private matching(): CrunchyrollSnapshot | null {
    const mediaId = crunchyrollIntegrationEnabled() ? crunchyrollPageMediaId() : null;
    if (!mediaId || this.snapshot?.mediaId !== mediaId || this.route !== crunchyrollPageRoute()) return null;
    return this.snapshot;
  }

  private async ensureBif(): Promise<void> {
    const blobUrl = this.matching()?.bifBlobUrl;
    if (!blobUrl?.startsWith('blob:')) return;
    if (this.bifSource !== blobUrl) {
      this.bif = null;
      this.bifFailed = false;
      this.bifSource = blobUrl;
    }
    if (this.bif || this.bifFailed) return;
    if (this.bifLoad && this.bifLoadUrl === blobUrl) return this.bifLoad;
    const generation = this.loadGeneration;
    const mediaId = this.snapshot?.mediaId;
    const route = this.route;
    const load = (async () => {
      let buffer: ArrayBuffer | null = null;
      try {
        const response = await fetch(blobUrl);
        if (response.ok) buffer = await response.arrayBuffer();
      } catch {
        // A revoked blob from a route change is discarded below.
        buffer = null;
      }
      if (generation !== this.loadGeneration || mediaId !== crunchyrollPageMediaId() || route !== crunchyrollPageRoute() || !crunchyrollIntegrationEnabled()) return;
      if (this.matching()?.bifBlobUrl !== blobUrl) return;
      const parsed = buffer && buffer.byteLength <= MAX_CRUNCHYROLL_BIF_BYTES ? parseRokuBif(buffer) : null;
      this.bif = parsed && parsed.frames.length > 0 ? parsed : null;
      this.bifFailed = !this.bif;
      this.bifSource = blobUrl;
    })();
    this.bifLoad = load;
    this.bifLoadUrl = blobUrl;
    void load.finally(() => {
      if (this.bifLoad !== load) return;
      this.bifLoad = null;
      this.bifLoadUrl = '';
    });
    return load;
  }

  async probe(): Promise<MediaCapabilities> {
    await this.load();
    await this.ensureBif();
    const snapshot = this.matching();
    return {
      captions: Boolean(snapshot && (snapshot.hostTracks.length > 0 || snapshot.captionTracks.length > 0)),
      chapters: Boolean(snapshot?.chapters.length),
      previews: Boolean(this.bif && snapshot)
    };
  }

  async listCaptionTracks(): Promise<CaptionTrack[]> {
    await this.load();
    void this.ensureBif();
    const snapshot = this.matching();
    if (!snapshot || snapshot.rendition === 'hardsub') return [];
    if (snapshot.hostTracks.length) {
      return snapshot.hostTracks.map(({ id, language, label, kind }) => ({
        id: `crunchyroll-host:${snapshot.mediaId}:${id}`,
        language,
        label,
        kind,
        source: 'crunchyroll',
        delivery: 'host'
      }));
    }
    return snapshot.captionTracks.map(({ id, language, label, kind }) => ({
      id, language, label, kind, source: 'crunchyroll', delivery: 'overlay'
    }));
  }

  async activateCaptionTrack(id: string | null): Promise<CaptionActivationResult> {
    this.cueGeneration += 1;
    const cue = this.cueGeneration;
    const failed = (): CaptionActivationResult => ({ status: 'failed', delivery: 'none', cues: [] });
    if (id === null) {
      const snapshot = this.matching();
      const live = snapshot && snapshot.hostTracks.length > 0 && snapshot.rendition !== 'hardsub'
        ? { mediaId: snapshot.mediaId, route: this.route }
        : null;
      const target = live ?? this.hostOffTarget;
      this.hostOffTarget = null;
      this.hostLift = null;
      releaseCrunchyrollHostCaptionSurface();
      const sameMedia = Boolean(
        target
        && crunchyrollIntegrationEnabled()
        && crunchyrollPageMediaId() === target.mediaId
        && crunchyrollPageRoute() === target.route
      );
      if (sameMedia && target) {
        let ok = false;
        try {
          ok = await requestCrunchyrollHostCaption(target.mediaId, target.route, null);
        } catch {
          ok = false;
        }
        if (cue !== this.cueGeneration || !ok) return failed();
      }
      return { status: 'off', delivery: 'none', cues: [] };
    }
    await this.load();
    if (cue !== this.cueGeneration) return failed();
    const snapshot = this.matching();
    if (!snapshot || snapshot.rendition === 'hardsub') return failed();
    const host = snapshot.hostTracks.find((item) => `crunchyroll-host:${snapshot.mediaId}:${item.id}` === id);
    if (host) {
      let ok = false;
      try {
        ok = await requestCrunchyrollHostCaption(snapshot.mediaId, this.route, host.id);
      } catch {
        ok = false;
      }
      if (cue !== this.cueGeneration) return failed();
      if (!ok || this.matching()?.mediaId !== snapshot.mediaId || crunchyrollPageRoute() !== this.route) {
        this.hostLift = null;
        releaseCrunchyrollHostCaptionSurface();
        return failed();
      }
      this.hostLift = { mediaId: snapshot.mediaId, route: this.route, trackId: host.id };
      retainCrunchyrollHostCaptionSurface();
      return { status: 'active', delivery: 'host', cues: [] };
    }
    if (cue !== this.cueGeneration) return failed();
    this.hostLift = null;
    releaseCrunchyrollHostCaptionSurface();
    const track = snapshot.captionTracks.find((item) => item.id === id);
    if (!track) return failed();
    const mediaId = snapshot.mediaId;
    const route = this.route;
    const body = await requestPageFetch(track.url);
    const currentTrack = this.matching()?.captionTracks.find((item) => item.id === id);
    const current = cue === this.cueGeneration
      && crunchyrollIntegrationEnabled()
      && crunchyrollPageMediaId() === mediaId
      && crunchyrollPageRoute() === route
      && currentTrack?.url === track.url;
    const cues = body && current ? parseCrunchyrollCaptionBody(body, track.format) : [];
    if (!cues.length) return failed();
    return { status: 'active', delivery: 'overlay', cues };
  }

  async getChapters(): Promise<Chapter[]> {
    await this.load();
    return this.matching()?.chapters || [];
  }

  async getPreviewSource(): Promise<PreviewSource> {
    await this.load();
    await this.ensureBif();
    return this.bif && this.matching()
      ? { kind: 'sprite', provider: 'crunchyroll' }
      : { kind: 'none', reason: 'no-crunchyroll-preview' };
  }

  getPreviewFrame(time: number): PreviewFrame | null {
    if (!this.bif || !this.matching() || !Number.isFinite(time) || time < 0) return null;
    let frame = this.bif.frames[0];
    for (const candidate of this.bif.frames) {
      if (time >= candidate.time) frame = candidate;
      else break;
    }
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return null;
    const bytes = new Uint8Array(this.bif.buffer.slice(frame.start, frame.end));
    if (this.previewBlob) URL.revokeObjectURL(this.previewBlob);
    this.previewBlob = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
    return {
      time: frame.time,
      width: this.bif.width,
      height: this.bif.height,
      image: {
        kind: 'sprite',
        url: this.previewBlob,
        x: 0,
        y: 0,
        tileWidth: this.bif.width,
        tileHeight: this.bif.height,
        sheetWidth: this.bif.width,
        sheetHeight: this.bif.height
      }
    };
  }

  mediaId(): string | null {
    return this.matching()?.mediaId || null;
  }

  getTitle(): string | null {
    return this.matching()?.title || null;
  }

  invalidate(options?: { preserveHostLift?: boolean }): void {
    const armOff = Boolean(
      !options?.preserveHostLift
      && this.route
      && this.snapshot
      && this.snapshot.rendition !== 'hardsub'
      && this.snapshot.hostTracks.length > 0
    );
    const hostOffTarget = armOff && this.snapshot
      ? { mediaId: this.snapshot.mediaId, route: this.route }
      : null;
    this.loadGeneration += 1;
    this.cueGeneration += 1;
    this.snapshot = null;
    this.route = '';
    this.pending = null;
    this.bif = null;
    this.bifFailed = false;
    this.bifLoad = null;
    this.bifLoadUrl = '';
    this.bifSource = '';
    this.hostOffTarget = hostOffTarget;
    if (!options?.preserveHostLift) {
      this.hostLift = null;
      releaseCrunchyrollHostCaptionSurface();
    }
    if (this.previewBlob && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(this.previewBlob);
    }
    this.previewBlob = null;
  }

  async reload(): Promise<void> {
    const mediaId = crunchyrollIntegrationEnabled() ? crunchyrollPageMediaId() : null;
    const route = crunchyrollPageRoute();
    const sameMedia = Boolean(mediaId && this.snapshot?.mediaId === mediaId && this.route === route);
    const preserveHostLift = Boolean(
      sameMedia
      && document.documentElement?.classList.contains(CRUNCHYROLL_HOST_CAPTION_CLASS)
    );
    const keptBif = sameMedia && this.bif && this.bifSource && this.bifSource === this.snapshot?.bifBlobUrl
      ? { bif: this.bif, bifFailed: this.bifFailed, bifSource: this.bifSource }
      : null;
    this.invalidate({ preserveHostLift });
    if (keptBif) {
      this.bif = keptBif.bif;
      this.bifFailed = keptBif.bifFailed;
      this.bifSource = keptBif.bifSource;
    }
    await this.load();
  }

  dispose(): void {
    this.invalidate();
  }
}
