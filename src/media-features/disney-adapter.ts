import { parseCaptionPayload } from './parsers/captions';
import {
  disneyPlayId,
  isDisneyHost,
  isSafeDisneyBifUrl,
  isSafeDisneyMasterUrl,
  parseDisneyHlsSubtitles,
  parseDisneyHlsVttPlaylist,
  parseRokuBif,
  alignDisneyVttCues,
  isDisneyTimelineBif,
  readDisneyContentTime,
  readPublishedDisneySnapshot,
  type DisneyBifSet,
  type DisneyPageCaption,
  type DisneyThumbnailMeta,
  type DisneyVttSegment
} from './parsers/disney-page';
import { isAllowedMediaFetchUrl, type MediaFetchRequest } from './fetch-allowlist';
import { requestMediaProbe, requestPageFetch } from './probe';
import type {
  CaptionActivationResult,
  CaptionCue,
  CaptionTrack,
  MediaCapabilities,
  MediaFeaturesAdapter,
  PreviewFrame,
  PreviewSource
} from './types';

const cueCache = new Map<string, CaptionCue[]>();
const MAX_BIF_BYTES = 16 * 1024 * 1024;
const CAPTION_WINDOW_BEHIND_SECONDS = 30;
const CAPTION_WINDOW_AHEAD_SECONDS = 120;
const CAPTION_RELOAD_AHEAD_SECONDS = 30;
const MAX_CAPTION_WINDOW_SEGMENTS = 48;

function looksLikePlaylist(body: string): boolean {
  return /^\s*#EXTM3U/i.test(body);
}

function looksLikeCaptionBody(body: string): boolean {
  const start = body.trim().slice(0, 80).toLowerCase();
  if (start.startsWith('<!doctype') || start.startsWith('<html')) return false;
  return /^WEBVTT/i.test(body.trim()) || parseCaptionPayload(body).length > 0;
}

async function fetchDisneyText(url: string, kind: MediaFetchRequest['kind']): Promise<string | null> {
  let absolute = url;
  try {
    absolute = new URL(url, window.location.href).toString();
  } catch {
    return null;
  }
  const request: MediaFetchRequest = { provider: 'disney', kind, url: absolute };
  if (!isAllowedMediaFetchUrl(request)) return null;
  const playlist = /\.m3u8(\?|$)/i.test(absolute);
  const matches = (body: string) => (playlist ? looksLikePlaylist(body) : looksLikeCaptionBody(body));

  try {
    const response = await fetch(absolute, { credentials: 'omit' });
    if (response.ok) {
      const text = await response.text();
      if (matches(text)) return text;
    }
  } catch {
    // Fall through to page fetch and the extension broker when CORS blocks the request.
  }

  const fromPage = await requestPageFetch(absolute, playlist ? 8000 : 12000);
  if (fromPage && matches(fromPage)) return fromPage;

  try {
    const result = await chrome.runtime.sendMessage({
      action: 'theater-fetch-media',
      ...request
    });
    const body = typeof result?.body === 'string' ? result.body : null;
    if (result?.ok && body && matches(body)) return body;
  } catch {
    return null;
  }
  return null;
}

async function loadArrayBuffer(url: string): Promise<ArrayBuffer | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength < 64 || buffer.byteLength > MAX_BIF_BYTES) return null;
    return buffer;
  } catch {
    return null;
  }
}

async function fetchDisneyBif(url: string, blobUrl?: string): Promise<ArrayBuffer | null> {
  if (blobUrl?.startsWith('blob:')) {
    const harvested = await loadArrayBuffer(blobUrl);
    if (harvested && isDisneyTimelineBif(harvested)) return harvested;
  }
  if (!isSafeDisneyBifUrl(url)) return null;
  const direct = await loadArrayBuffer(url);
  if (direct && isDisneyTimelineBif(direct)) return direct;
  const fromPage = await requestPageFetch(url, 20000);
  if (fromPage?.startsWith('blob:')) {
    try {
      const buffer = await loadArrayBuffer(fromPage);
      if (buffer && isDisneyTimelineBif(buffer)) return buffer;
    } finally {
      try {
        URL.revokeObjectURL(fromPage);
      } catch {
        // Blob URLs created in MAIN may not be revocable from isolated world.
      }
    }
  }
  return null;
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      out[index] = await fn(items[index], index);
    }
  }
  const workers = Math.min(Math.max(1, limit), items.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return out;
}

function activeVideoTime(): number {
  if (typeof document === 'undefined') return 0;
  const video = document.querySelector('video.theater-everywhere-video-active, video[data-theater-everywhere]') as HTMLVideoElement | null
    || document.querySelector('video');
  const playhead = readDisneyContentTime(video);
  if (playhead != null && playhead > 0) return playhead;
  const now = video?.currentTime;
  return Number.isFinite(now) && (now as number) > 0 ? now as number : 0;
}

export function captionSegmentsForWindow(segments: DisneyVttSegment[], time: number): DisneyVttSegment[] {
  const start = Math.max(0, time - CAPTION_WINDOW_BEHIND_SECONDS);
  const end = time + CAPTION_WINDOW_AHEAD_SECONDS;
  const selected = segments.filter((segment) => {
    const segmentEnd = segment.start + Math.max(segment.duration, 1);
    return segmentEnd >= start && segment.start <= end;
  });
  if (selected.length > 0) return selected.slice(0, MAX_CAPTION_WINDOW_SEGMENTS);
  return segments
    .map((segment, index) => ({ segment, index, distance: Math.abs(segment.start - time) }))
    .sort((left, right) => left.distance - right.distance || left.index - right.index)
    .slice(0, Math.min(12, MAX_CAPTION_WINDOW_SEGMENTS))
    .map((item) => item.segment)
    .sort((left, right) => left.start - right.start);
}

function sortCues(cues: CaptionCue[]): CaptionCue[] {
  return cues.slice().sort((left, right) => left.start - right.start || left.end - right.end);
}

export function dedupeCaptionCues(cues: CaptionCue[]): CaptionCue[] {
  const seen = new Set<string>();
  return sortCues(cues).filter((cue) => {
    const key = `${cue.start}:${cue.end}:${cue.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export class DisneyAdapter implements MediaFeaturesAdapter {
  private snapshot: {
    mediaId?: string;
    duration?: number;
    masterUrl?: string;
    storyboardUrl?: string;
    thumbnail?: DisneyThumbnailMeta;
  } | null = null;
  private tracks: DisneyPageCaption[] = [];
  private bif: DisneyBifSet | null = null;
  private previewBlob: string | null = null;
  private bifLoad: Promise<void> | null = null;
  private tracksLoad: Promise<void> | null = null;
  private activeCaption: {
    trackId: string;
    mediaId: string | null;
    segments: DisneyVttSegment[];
    cuesBySegment: Map<string, CaptionCue[]>;
    loadedStart: number;
    loadedEnd: number;
  } | null = null;
  private captionLoadGeneration = 0;

  private readHarvest(): void {
    const mediaId = disneyPlayId(window.location.href);
    const harvested = readPublishedDisneySnapshot();
    const masterUrl = [this.snapshot?.masterUrl, harvested?.masterUrl]
      .find((url): url is string => Boolean(url && isSafeDisneyMasterUrl(url)));
    const bifUrl = [this.snapshot?.storyboardUrl, harvested?.storyboardUrl, harvested?.thumbnail?.bifUrl]
      .find((url): url is string => Boolean(url && isSafeDisneyBifUrl(url)));
    const thumbnail = harvested?.thumbnail || this.snapshot?.thumbnail || (bifUrl
      ? { width: 480, height: 270, intervalMs: 10_000, bifUrl }
      : undefined);
    const nextId = harvested?.mediaId || mediaId || this.snapshot?.mediaId;
    if (this.snapshot?.mediaId && nextId && this.snapshot.mediaId !== nextId) {
      this.tracks = [];
      this.bif = null;
      this.bifLoad = null;
      this.tracksLoad = null;
      cueCache.clear();
      this.activeCaption = null;
      this.captionLoadGeneration += 1;
      if (typeof document !== 'undefined') {
        for (const video of document.querySelectorAll('video')) {
          delete (video as HTMLVideoElement).dataset.teDisneyPlayhead;
        }
      }
    }
    this.snapshot = {
      mediaId: nextId || undefined,
      duration: harvested?.duration || this.snapshot?.duration,
      masterUrl,
      storyboardUrl: bifUrl,
      thumbnail
    };
  }

  private async ensureTracks(): Promise<void> {
    this.readHarvest();
    if (this.tracks.length > 0) return;
    if (this.tracksLoad) return this.tracksLoad;
    this.tracksLoad = (async () => {
      this.readHarvest();
      if (!this.snapshot?.masterUrl) {
        const probed = await requestMediaProbe(1500);
        this.readHarvest();
        const fromProbe = probed.disney?.masterUrl;
        if (fromProbe && isSafeDisneyMasterUrl(fromProbe)) {
          this.snapshot = { ...this.snapshot, masterUrl: fromProbe, mediaId: this.snapshot?.mediaId || probed.disney?.mediaId };
        }
      }
      const url = this.snapshot?.masterUrl;
      if (!url) return;
      const playlist = await fetchDisneyText(url, 'caption-track');
      this.tracks = playlist ? parseDisneyHlsSubtitles(playlist, url) : [];
    })().finally(() => {
      if (this.tracks.length === 0) this.tracksLoad = null;
    });
    return this.tracksLoad;
  }

  private async ensureBif(): Promise<void> {
    if (this.bif) return;
    if (this.bifLoad) return this.bifLoad;
    this.bifLoad = (async () => {
      this.readHarvest();
      const harvested = readPublishedDisneySnapshot();
      const bifUrl = this.snapshot?.storyboardUrl || harvested?.thumbnail?.bifUrl || '';
      const bifBlobUrl = harvested?.bifBlobUrl;
      if (!bifUrl && !bifBlobUrl) return;
      const buffer = await fetchDisneyBif(bifUrl, bifBlobUrl);
      const parsed = buffer ? parseRokuBif(buffer, this.snapshot?.thumbnail) : null;
      this.bif = parsed && isDisneyTimelineBif(parsed.buffer) ? parsed : null;
    })().finally(() => {
      if (!this.bif) this.bifLoad = null;
    });
    return this.bifLoad;
  }

  async load(): Promise<void> {
    this.readHarvest();
    if (!this.snapshot?.masterUrl) {
      const probed = await requestMediaProbe(1500);
      const masterUrl = probed.disney?.masterUrl;
      if (masterUrl && isSafeDisneyMasterUrl(masterUrl)) {
        this.snapshot = {
          ...this.snapshot,
          mediaId: this.snapshot?.mediaId || probed.disney?.mediaId,
          duration: this.snapshot?.duration || probed.disney?.duration,
          masterUrl,
          storyboardUrl: this.snapshot?.storyboardUrl || probed.disney?.storyboardUrl,
          thumbnail: this.snapshot?.thumbnail || probed.disney?.thumbnail
        };
      }
    }
    await Promise.all([this.ensureTracks(), this.ensureBif()]);
  }

  async probe(): Promise<MediaCapabilities> {
    if (!this.snapshot) await this.load();
    else await this.ensureTracks();
    void this.ensureBif();
    return {
      captions: this.tracks.length > 0,
      chapters: false,
      previews: Boolean(this.bif)
    };
  }

  async listCaptionTracks(): Promise<CaptionTrack[]> {
    await this.ensureTracks();
    void this.ensureBif();
    return this.tracks.map((track) => ({
      id: track.id,
      language: track.language,
      label: track.label || track.language || 'Captions',
      kind: 'captions' as const,
      source: 'disney' as const,
      autoGenerated: false
    }));
  }

  private async loadCaptionWindow(id: string, time: number, force = false): Promise<CaptionActivationResult> {
    const active = this.activeCaption;
    if (!active || active.trackId !== id) return { status: 'failed', delivery: 'none', cues: [] };
    if (!force && time >= active.loadedStart && time <= active.loadedEnd - CAPTION_RELOAD_AHEAD_SECONDS) {
      return { status: 'active', delivery: 'overlay', cues: dedupeCaptionCues([...active.cuesBySegment.values()].flat()) };
    }
    const generation = ++this.captionLoadGeneration;
    const mediaId = active.mediaId;
    const selected = captionSegmentsForWindow(active.segments, time);
    let fetchedAny = false;
    const missing = selected.filter((segment) => !active.cuesBySegment.has(segment.url));
    let bodies = await mapPool(missing, 8, (segment) => fetchDisneyText(segment.url, 'caption-track'));
    if (bodies.some((body) => !body)) {
      bodies = await mapPool(missing, 8, (segment, index) => (
        bodies[index] ? Promise.resolve(bodies[index]) : fetchDisneyText(segment.url, 'caption-track')
      ));
    }
    if (generation !== this.captionLoadGeneration || this.mediaId() !== mediaId || this.activeCaption !== active) {
      return { status: 'failed', delivery: 'none', cues: [] };
    }
    for (let index = 0; index < missing.length; index++) {
      const body = bodies[index];
      if (!body) continue;
      fetchedAny = true;
      const segment = missing[index];
      active.cuesBySegment.set(
        segment.url,
        alignDisneyVttCues(parseCaptionPayload(body), segment.start, segment.duration)
      );
    }
    const selectedUrls = new Set(selected.map((segment) => segment.url));
    for (const url of active.cuesBySegment.keys()) {
      if (!selectedUrls.has(url)) active.cuesBySegment.delete(url);
    }
    active.loadedStart = selected.length > 0 ? selected[0].start : time;
    const last = selected.at(-1);
    active.loadedEnd = last ? last.start + Math.max(last.duration, 1) : time;
    if (missing.length > 0 && !fetchedAny && active.cuesBySegment.size === 0) {
      return { status: 'failed', delivery: 'none', cues: [] };
    }
    return { status: 'active', delivery: 'overlay', cues: dedupeCaptionCues([...active.cuesBySegment.values()].flat()) };
  }

  async activateCaptionTrack(id: string | null): Promise<CaptionActivationResult> {
    if (id === null) {
      this.captionLoadGeneration += 1;
      this.activeCaption = null;
      return { status: 'off', delivery: 'none', cues: [] };
    }
    await this.ensureTracks();
    const track = this.tracks.find((item) => item.id === id);
    if (!track) return { status: 'failed', delivery: 'none', cues: [] };
    const cached = cueCache.get(track.url);
    if (cached && cached.length > 0) return { status: 'active', delivery: 'overlay', cues: cached };
    const playlist = await fetchDisneyText(track.url, 'caption-track');
    if (!playlist) return { status: 'failed', delivery: 'none', cues: [] };
    const segments = parseDisneyHlsVttPlaylist(playlist, track.url);
    if (segments.length === 0) {
      const cues = sortCues(parseCaptionPayload(playlist));
      if (cues.length > 0) cueCache.set(track.url, cues);
      return cues.length > 0
        ? { status: 'active', delivery: 'overlay', cues }
        : { status: 'failed', delivery: 'none', cues: [] };
    }
    this.activeCaption = {
      trackId: id,
      mediaId: this.mediaId(),
      segments,
      cuesBySegment: new Map(),
      loadedStart: Number.POSITIVE_INFINITY,
      loadedEnd: Number.NEGATIVE_INFINITY
    };
    return this.loadCaptionWindow(id, activeVideoTime(), true);
  }

  refreshCaptionCues(id: string, time: number): Promise<CaptionActivationResult> {
    return this.loadCaptionWindow(id, time);
  }

  async getPreviewSource(): Promise<PreviewSource> {
    await this.ensureBif();
    return this.bif
      ? { kind: 'sprite', provider: 'disney' }
      : { kind: 'none', reason: 'no-storyboard' };
  }

  getPreviewFrame(time: number, _duration: number): PreviewFrame | null {
    if (!this.bif || !Number.isFinite(time) || time < 0) return null;
    let frame = this.bif.frames[0];
    for (const candidate of this.bif.frames) {
      if (time >= candidate.time) frame = candidate;
      else break;
    }
    const bytes = new Uint8Array(this.bif.buffer.slice(frame.start, frame.end));
    const blob = new Blob([bytes], { type: 'image/jpeg' });
    if (this.previewBlob) URL.revokeObjectURL(this.previewBlob);
    this.previewBlob = URL.createObjectURL(blob);
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
    return this.snapshot?.mediaId || disneyPlayId(window.location.href);
  }

  async reload(): Promise<void> {
    const mediaId = disneyPlayId(window.location.href);
    if (this.snapshot?.mediaId && mediaId && this.snapshot.mediaId === mediaId && this.tracks.length > 0) {
      this.readHarvest();
      void this.ensureBif();
      return;
    }
    this.snapshot = null;
    this.tracks = [];
    this.bifLoad = null;
    this.tracksLoad = null;
    await this.load();
  }

  invalidate(): void {
    this.captionLoadGeneration += 1;
    this.activeCaption = null;
    this.snapshot = null;
    this.tracks = [];
    this.bif = null;
    this.bifLoad = null;
    this.tracksLoad = null;
    cueCache.clear();
    if (this.previewBlob) {
      URL.revokeObjectURL(this.previewBlob);
      this.previewBlob = null;
    }
  }

  dispose(): void {
    this.invalidate();
  }
}

export { isDisneyHost };
