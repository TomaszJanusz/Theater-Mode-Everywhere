import { isPlaybackSurface, nativeVideoOf, type PlaybackSurface } from './playback-surface';
import {
  hostIsAtLiveHead,
  hostLiveHint,
  hostLiveSeekAttempt,
  hostMediaSeekAttempts,
  LIVE_EDGE_SECONDS,
  MAX_LIVE_DVR_SECONDS,
  MIN_LIVE_DVR_SECONDS,
  readHostLiveBounds,
  readHostVodDuration,
  readProviderClock,
  type MediaSeekDetail
} from './providers/timeline';

export type { MediaSeekDetail } from './providers/timeline';
export {
  hostIsAtLiveHead,
  hostLiveHint,
  LIVE_EDGE_SECONDS,
  MAX_LIVE_DVR_SECONDS,
  MIN_LIVE_DVR_SECONDS
};

export type PlaybackWindow = {
  start: number;
  end: number;
  duration: number;
  seekable: boolean;
  live: boolean;
};

export type PlaybackWindowOptions = {
  live?: boolean;
  duration?: number;
};

const SLIDING_DVR_START_SECONDS = 5;
export const MEDIA_SEEK_EVENT = 'theater-everywhere-media-seek';
const PENDING_MEDIA_SEEK_MS = 10_000;
const PENDING_MEDIA_SEEK_ARRIVED_SECONDS = 1.25;
const HOST_SEEK_RESUME_GRACE_MS = 4_000;

const pendingMediaSeeks = new WeakMap<HTMLVideoElement, { time: number; until: number }>();
const pendingNativeSeekResumes = new WeakMap<HTMLVideoElement, () => void>();
const pendingHostSeekResumes = new WeakMap<HTMLVideoElement, number>();

function seekableBounds(video: HTMLVideoElement): { start: number; end: number } | null {
  try {
    const range = video.seekable;
    if (!range || range.length === 0) return null;
    const start = range.start(0);
    const end = range.end(range.length - 1);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
    const span = end - start;
    if (span < MIN_LIVE_DVR_SECONDS || span > MAX_LIVE_DVR_SECONDS) return null;
    const now = video.currentTime;
    if (Number.isFinite(now) && (now + 1 < start || now - 30 > end)) return null;
    return { start, end };
  } catch {
    return null;
  }
}

function finiteDuration(video: HTMLVideoElement): number | null {
  const mediaDuration = video.duration;
  if (!Number.isFinite(mediaDuration) || mediaDuration <= 0) return null;
  return mediaDuration;
}

function prefixSeekableEnd(video: HTMLVideoElement): number | null {
  try {
    const range = video.seekable;
    if (!range || range.length === 0) return null;
    const start = range.start(0);
    const end = range.end(range.length - 1);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
    if (start > SLIDING_DVR_START_SECONDS) return null;
    if (end - start > MAX_LIVE_DVR_SECONDS) return null;
    return end;
  } catch {
    return null;
  }
}

function unknownLengthVodWindow(video: HTMLVideoElement): PlaybackWindow | null {
  const end = prefixSeekableEnd(video);
  if (end == null) return null;
  return {
    start: 0,
    end,
    duration: end,
    seekable: true,
    live: false
  };
}

function usableHostDuration(video: HTMLVideoElement, duration: number | null | undefined): number | null {
  if (duration == null || !Number.isFinite(duration) || duration <= 0) return null;
  const now = video.currentTime;
  if (Number.isFinite(now) && duration + 1 < now) return null;
  const prefix = prefixSeekableEnd(video);
  if (prefix != null && duration + 1 < prefix) return null;
  return duration;
}

function hostKnownVodDuration(video: HTMLVideoElement): number | null {
  return usableHostDuration(video, readHostVodDuration(video));
}

function boundsWindow(bounds: { start: number; end: number }): PlaybackWindow {
  return {
    start: bounds.start,
    end: bounds.end,
    duration: bounds.end - bounds.start,
    seekable: true,
    live: true
  };
}

function liveWindow(video: HTMLVideoElement): PlaybackWindow {
  const hostBounds = readHostLiveBounds(video);
  if (hostBounds) return boundsWindow(hostBounds);
  const bounds = seekableBounds(video);
  if (bounds) return boundsWindow(bounds);
  const duration = finiteDuration(video);
  if (duration != null) {
    return {
      start: 0,
      end: duration,
      duration,
      seekable: true,
      live: true
    };
  }
  return {
    start: 0,
    end: 0,
    duration: 0,
    seekable: false,
    live: true
  };
}

function surfacePlaybackWindow(surface: PlaybackSurface): PlaybackWindow {
  const duration = surface.duration;
  if (Number.isFinite(duration) && duration > 0) {
    return { start: 0, end: duration, duration, seekable: true, live: false };
  }
  return { start: 0, end: 0, duration: 0, seekable: false, live: false };
}

export function playbackWindow(
  media: HTMLVideoElement | PlaybackSurface,
  options?: PlaybackWindowOptions
): PlaybackWindow {
  if (isPlaybackSurface(media) && !media.capabilities.nativeMedia) return surfacePlaybackWindow(media);
  const video = nativeVideoOf(media) || media as HTMLVideoElement;
  const live = options?.live ?? hostLiveHint(video);
  if (live) return liveWindow(video);

  const duration = usableHostDuration(
    video,
    options?.duration ?? finiteDuration(video) ?? hostKnownVodDuration(video)
  );
  if (duration != null) {
    return {
      start: 0,
      end: duration,
      duration,
      seekable: true,
      live: false
    };
  }

  const unknownVod = unknownLengthVodWindow(video);
  if (unknownVod) return unknownVod;

  // Infinity with no VOD prefix is a live stream. NaN is only "not loaded yet".
  if (video.duration === Number.POSITIVE_INFINITY) return liveWindow(video);
  return {
    start: 0,
    end: 0,
    duration: 0,
    seekable: false,
    live: false
  };
}

/** Keep the last real VOD or live window while the element has no timeline yet. */
export function presentPlaybackWindow(previous: PlaybackWindow | null, next: PlaybackWindow): PlaybackWindow {
  if (next.live || next.seekable) return next;
  if (previous && (previous.live || previous.seekable)) return previous;
  return next;
}

export function clampToWindow(time: number, window: PlaybackWindow): number {
  if (!window.seekable) return time;
  return Math.min(window.end, Math.max(window.start, time));
}

export function timeToRatio(time: number, window: PlaybackWindow): number {
  if (!window.seekable || window.duration <= 0) return window.live ? 1 : 0;
  const ratio = (time - window.start) / window.duration;
  if (!Number.isFinite(ratio)) return window.live ? 1 : 0;
  return Math.min(1, Math.max(0, ratio));
}

export function ratioToTime(ratio: number, window: PlaybackWindow): number {
  if (!window.seekable) return window.end;
  const clamped = Math.min(1, Math.max(0, ratio));
  return window.start + clamped * window.duration;
}

export function isAtLiveEdge(time: number, window: PlaybackWindow, threshold = LIVE_EDGE_SECONDS): boolean {
  if (!window.live) return false;
  if (!window.seekable) return true;
  return window.end - time <= threshold;
}

export function isVideoAtLiveEdge(media: HTMLVideoElement | PlaybackSurface, window?: PlaybackWindow): boolean {
  const video = nativeVideoOf(media);
  if (!video) return false;
  const shown = displayMediaTime(video);
  const pendingAway = Math.abs(shown - (video.currentTime || 0)) > PENDING_MEDIA_SEEK_ARRIVED_SECONDS;
  if (hostIsAtLiveHead(video) && !pendingAway) return true;
  return isAtLiveEdge(shown, window ?? playbackWindow(video));
}

export function displayMediaTime(media: HTMLVideoElement | PlaybackSurface): number {
  if (isPlaybackSurface(media) && !media.capabilities.nativeMedia) return media.currentTime || 0;
  const video = nativeVideoOf(media) || media as HTMLVideoElement;
  const now = readProviderClock(video) ?? (video.currentTime || 0);
  const pending = pendingMediaSeeks.get(video);
  if (!pending) return now;
  if (Math.abs(now - pending.time) <= PENDING_MEDIA_SEEK_ARRIVED_SECONDS || Date.now() >= pending.until) {
    pendingMediaSeeks.delete(video);
    return now;
  }
  return pending.time;
}

export function clearPendingMediaSeek(media: HTMLVideoElement | PlaybackSurface): void {
  const video = nativeVideoOf(media);
  if (!video) return;
  pendingMediaSeeks.delete(video);
}

function rememberPendingMediaSeek(video: HTMLVideoElement, time: number): void {
  if (!Number.isFinite(time)) return;
  pendingMediaSeeks.set(video, { time, until: Date.now() + PENDING_MEDIA_SEEK_MS });
}

function requestHostMediaSeek(detail: MediaSeekDetail): boolean {
  const target = typeof globalThis === 'object' ? (globalThis as typeof globalThis & { window?: Window }).window : undefined;
  if (!target || typeof target.dispatchEvent !== 'function') return false;
  target.dispatchEvent(new CustomEvent(MEDIA_SEEK_EVENT, { detail }));
  return true;
}

function shouldResumeAfterSeek(video: HTMLVideoElement): boolean {
  if (!video.paused) return true;
  const until = pendingHostSeekResumes.get(video);
  if (!until || Date.now() >= until) {
    pendingHostSeekResumes.delete(video);
    return false;
  }
  return true;
}

function rememberHostSeekResume(video: HTMLVideoElement, resumeAfterSeek: boolean): void {
  if (!resumeAfterSeek) {
    pendingHostSeekResumes.delete(video);
    return;
  }
  pendingHostSeekResumes.set(video, Date.now() + HOST_SEEK_RESUME_GRACE_MS);
}

function preserveNativePlaybackThroughSeek(video: HTMLVideoElement, resumeAfterSeek: boolean): void {
  pendingNativeSeekResumes.get(video)?.();
  if (!resumeAfterSeek || typeof video.addEventListener !== 'function') return;

  let settled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const cleanup = () => {
    if (settled) return;
    settled = true;
    video.removeEventListener('seeked', resume);
    video.removeEventListener('canplay', resume);
    if (timer) clearTimeout(timer);
    pendingNativeSeekResumes.delete(video);
  };
  const resume = () => {
    if (video.seeking || video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) return;
    cleanup();
    if (video.paused) void video.play().catch(() => {});
  };
  pendingNativeSeekResumes.set(video, cleanup);
  video.addEventListener('seeked', resume);
  video.addEventListener('canplay', resume);
  timer = setTimeout(resume, 4_000);
}

export function cancelPendingSeekResume(video: HTMLVideoElement): void {
  pendingNativeSeekResumes.get(video)?.();
  pendingHostSeekResumes.delete(video);
  requestHostMediaSeek({ cancelPendingResume: true });
}

export function seekToMediaTime(media: HTMLVideoElement | PlaybackSurface, time: number): void {
  if (isPlaybackSurface(media) && !media.capabilities.nativeMedia) {
    const surfaceWindow = playbackWindow(media);
    media.currentTime = surfaceWindow.seekable ? clampToWindow(time, surfaceWindow) : time;
    return;
  }
  const video = nativeVideoOf(media) || media as HTMLVideoElement;
  const window = playbackWindow(video);
  const target = window.seekable ? clampToWindow(time, window) : time;
  // Hosts such as Disney+ may transiently expose a paused HTMLMediaElement
  // while they buffer a seek. Keep the original playback intent across a
  // burst of arrow-key seeks, rather than treating the second keypress as a
  // seek requested from the paused state.
  const resumeAfterSeek = shouldResumeAfterSeek(video);
  rememberPendingMediaSeek(video, target);
  for (const attempt of hostMediaSeekAttempts(video, {
    target,
    windowLive: window.live,
    atLiveEdge: isAtLiveEdge(target, window),
    resumeAfterSeek
  })) {
    if (!requestHostMediaSeek(attempt.detail)) continue;
    if (attempt.rememberResume) rememberHostSeekResume(video, resumeAfterSeek);
    return;
  }
  preserveNativePlaybackThroughSeek(video, resumeAfterSeek);
  video.currentTime = target;
}

export function seekToLive(video: HTMLVideoElement): boolean {
  const window = playbackWindow(video);
  if (!window.live) return false;
  rememberPendingMediaSeek(video, window.end);
  const liveAttempt = hostLiveSeekAttempt(video);
  if (liveAttempt && requestHostMediaSeek(liveAttempt.detail)) return true;
  if (!window.seekable) {
    clearPendingMediaSeek(video);
    return false;
  }
  video.currentTime = window.end;
  return true;
}

export function seekBy(media: HTMLVideoElement | PlaybackSurface, delta: number): boolean {
  const window = playbackWindow(media);
  if (!window.seekable) return false;
  seekToMediaTime(media, displayMediaTime(media) + delta);
  return true;
}
