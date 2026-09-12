import { MAX_CAPTION_BYTES } from './fetch-allowlist';
import { parseCaptionPayload, parseSrt, parseWebVtt } from './parsers/captions';
import { sanitizeCaptionCueText, sanitizeCaptionText } from './sanitize';
import type { CaptionCue, CaptionTrack, Chapter, MediaCapabilities, MediaFeaturesAdapter } from './types';

const TRACK_NONE = 0;
const TRACK_LOADING = 1;
const TRACK_WAIT_MS = 500;
const TRACK_WAIT_MS_NO_ELEMENT = 80;

function trackUsable(track: TextTrack): boolean {
  const kind = track.kind as string;
  return kind === 'subtitles' || kind === 'captions' || kind === '';
}

function chapterUsable(track: TextTrack): boolean {
  return track.kind === 'chapters';
}

function trackElementUsable(el: HTMLTrackElement): boolean {
  const kind = el.kind || 'subtitles';
  return kind === 'subtitles' || kind === 'captions';
}

type CueLike = {
  startTime: number;
  endTime: number;
  text?: unknown;
};

function isCueLike(cue: unknown): cue is CueLike {
  if (!cue || typeof cue !== 'object') return false;
  const item = cue as CueLike;
  return Number.isFinite(item.startTime) && Number.isFinite(item.endTime);
}

export function cuesFromTrack(track: TextTrack): CaptionCue[] {
  const cues: CaptionCue[] = [];
  const list = track.cues;
  if (!list) return cues;
  for (let i = 0; i < list.length; i++) {
    const cue = list[i];
    if (!isCueLike(cue)) continue;
    const raw = typeof cue.text === 'string' ? cue.text : '';
    const text = sanitizeCaptionCueText(raw);
    if (!text) continue;
    cues.push({
      start: cue.startTime,
      end: cue.endTime > cue.startTime ? cue.endTime : cue.startTime + 0.001,
      text
    });
  }
  return cues;
}

export function matchingTrackElement(
  video: HTMLVideoElement,
  track: TextTrack,
  index: number
): HTMLTrackElement | null {
  const els = Array.from(video.querySelectorAll('track')).filter(trackElementUsable);
  const trackKind = track.kind === 'captions' ? 'captions' : 'subtitles';
  const byLang = els.find((el) => {
    const kind = el.kind === 'captions' ? 'captions' : 'subtitles';
    return kind === trackKind && (el.srclang || '') === (track.language || '');
  });
  if (byLang) return byLang;
  return els[index] || null;
}

export function parseNativeTrackPayload(body: string): CaptionCue[] {
  const trimmed = body.replace(/^\uFEFF/, '').trimStart();
  if (/^WEBVTT/i.test(trimmed)) return parseWebVtt(body);
  const vtt = parseWebVtt(body);
  if (vtt.length > 0) return vtt;
  const srt = parseSrt(body);
  if (srt.length > 0) return srt;
  return parseCaptionPayload(body);
}

function isSafeTrackUrl(url: URL): boolean {
  return url.protocol === 'http:' || url.protocol === 'https:';
}

async function fetchTrackSource(src: string, baseHref: string): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(src, baseHref);
  } catch {
    return null;
  }
  if (!isSafeTrackUrl(url)) return null;
  try {
    const response = await fetch(url.href, { credentials: 'same-origin' });
    if (!response.ok) return null;
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_CAPTION_BYTES) return null;
    return new TextDecoder().decode(buffer);
  } catch {
    return null;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

async function waitForTrackCues(track: TextTrack, timeoutMs: number): Promise<CaptionCue[]> {
  const existing = cuesFromTrack(track);
  if (existing.length > 0) return existing;

  return await new Promise((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      globalThis.clearInterval(poll);
      globalThis.clearTimeout(timer);
      track.removeEventListener('cuechange', onChange);
      resolve(cuesFromTrack(track));
    };
    const onChange = (): void => {
      if (cuesFromTrack(track).length > 0) finish();
    };
    track.addEventListener('cuechange', onChange);
    const poll = globalThis.setInterval(() => {
      if (cuesFromTrack(track).length > 0) finish();
    }, 40);
    const timer = globalThis.setTimeout(finish, timeoutMs);
  });
}

export class NativeTextTrackAdapter implements MediaFeaturesAdapter {
  private video: HTMLVideoElement;
  private restoredModes = new Map<TextTrack, TextTrackMode>();
  private overlayTrack: TextTrack | null = null;
  private watching = false;
  private boundOnTracksChange = (): void => {
    this.enforceOverlayTrackMode();
  };

  constructor(video: HTMLVideoElement) {
    this.video = video;
  }

  async probe(): Promise<MediaCapabilities> {
    const tracks = Array.from(this.video.textTracks || []);
    return {
      captions: tracks.some(trackUsable),
      chapters: tracks.some(chapterUsable),
      previews: false
    };
  }

  async listCaptionTracks(): Promise<CaptionTrack[]> {
    const tracks = Array.from(this.video.textTracks || []);
    return tracks.filter(trackUsable).map((track, index) => ({
      id: `native:${index}`,
      language: track.language || '',
      label: track.label || track.language || '',
      kind: track.kind === 'captions' ? 'captions' : 'subtitles',
      source: 'native-text-track'
    }));
  }

  async activateCaptionTrack(id: string | null): Promise<CaptionCue[] | null> {
    const tracks = Array.from(this.video.textTracks || []).filter(trackUsable);
    if (id === null) {
      this.stopWatching();
      for (const track of tracks) this.setTrackMode(track, 'disabled');
      return null;
    }
    const index = Number(id.replace('native:', ''));
    const selected = tracks[index];
    if (!selected) {
      this.stopWatching();
      for (const track of tracks) this.setTrackMode(track, 'disabled');
      return [];
    }

    this.overlayTrack = selected;
    tracks.forEach((track, i) => {
      this.setTrackMode(track, i === index ? 'hidden' : 'disabled');
    });
    this.startWatching();

    let cues = cuesFromTrack(selected);
    if (cues.length === 0) {
      const trackEl = matchingTrackElement(this.video, selected, index);
      const readyState = typeof trackEl?.readyState === 'number' ? trackEl.readyState : TRACK_NONE;
      const shouldWait = !trackEl || readyState === TRACK_NONE || readyState === TRACK_LOADING;
      if (shouldWait) {
        cues = await waitForTrackCues(selected, trackEl ? TRACK_WAIT_MS : TRACK_WAIT_MS_NO_ELEMENT);
      }
    }
    if (cues.length === 0) {
      cues = await this.fetchCuesFromTrackElement(selected, index);
    }
    return cues;
  }

  invalidate(): void {
    this.stopWatching();
    const tracks = Array.from(this.video.textTracks || []).filter(trackUsable);
    for (const track of tracks) this.setTrackMode(track, 'disabled');
  }

  async getChapters(): Promise<Chapter[]> {
    const tracks = Array.from(this.video.textTracks || []).filter(chapterUsable);
    for (const track of tracks) {
      if (track.mode === 'disabled') {
        this.restoredModes.set(track, track.mode);
        this.setTrackMode(track, 'hidden');
      }
      if (!track.cues || track.cues.length === 0) {
        await delay(50);
      }
      const cues = cuesFromTrack(track);
      if (cues.length === 0) continue;
      return cues.map((cue, index) => ({
        start: cue.start,
        end: index + 1 < cues.length ? cues[index + 1].start : cue.end,
        title: sanitizeCaptionText(cue.text),
        source: 'native-chapters',
        confidence: 'high' as const
      }));
    }
    return [];
  }

  dispose(): void {
    this.stopWatching();
    this.restoredModes.forEach((mode, track) => {
      this.setTrackMode(track, mode);
    });
    this.restoredModes.clear();
  }

  private async fetchCuesFromTrackElement(track: TextTrack, index: number): Promise<CaptionCue[]> {
    const trackEl = matchingTrackElement(this.video, track, index);
    const src = trackEl?.src;
    if (!src) return [];
    const baseHref = typeof document !== 'undefined' && document.baseURI
      ? document.baseURI
      : 'https://localhost/';
    const body = await fetchTrackSource(src, baseHref);
    if (!body) return [];
    return parseNativeTrackPayload(body);
  }

  private startWatching(): void {
    if (this.watching) return;
    const list = this.video.textTracks;
    if (!list?.addEventListener) return;
    this.watching = true;
    list.addEventListener('change', this.boundOnTracksChange);
  }

  private stopWatching(): void {
    if (this.watching) {
      this.video.textTracks?.removeEventListener('change', this.boundOnTracksChange);
      this.watching = false;
    }
    this.overlayTrack = null;
  }

  private enforceOverlayTrackMode(): void {
    if (!this.overlayTrack) return;
    const tracks = Array.from(this.video.textTracks || []).filter(trackUsable);
    for (const track of tracks) {
      const desired: TextTrackMode = track === this.overlayTrack ? 'hidden' : 'disabled';
      if (track.mode !== desired) this.setTrackMode(track, desired);
    }
  }

  private setTrackMode(track: TextTrack, mode: TextTrackMode): void {
    try {
      if (track.mode !== mode) track.mode = mode;
    } catch {
      // Some players freeze TextTrack.mode during media replacement.
    }
  }
}
