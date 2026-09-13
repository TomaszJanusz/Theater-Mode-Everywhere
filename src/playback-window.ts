export type PlaybackWindow = {
  start: number;
  end: number;
  duration: number;
  seekable: boolean;
  live: boolean;
};

export type PlaybackWindowOptions = {
  live?: boolean;
};

export const LIVE_EDGE_SECONDS = 2;
export const MIN_LIVE_DVR_SECONDS = 15;
export const MAX_LIVE_DVR_SECONDS = 24 * 60 * 60;
export const MEDIA_SEEK_EVENT = 'theater-everywhere-media-seek';

type YoutubePlayerHost = HTMLElement & {
  getVideoData?: () => { isLive?: boolean } | null;
};

export type MediaSeekDetail = {
  live?: boolean;
  time?: number;
};

function youtubePlayerHost(node: Element | null): YoutubePlayerHost | null {
  if (!node || typeof (node as Element).querySelector !== 'function') return null;
  return node as YoutubePlayerHost;
}

function youtubePlayerFor(video: HTMLVideoElement): YoutubePlayerHost | null {
  if (typeof video.closest === 'function') {
    const closest = youtubePlayerHost(video.closest('#movie_player, .html5-video-player'));
    if (closest) return closest;
  }
  if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return null;
  return youtubePlayerHost(document.querySelector('#movie_player, .html5-video-player'));
}

function youtubeProgressTimes(player: YoutubePlayerHost): { min: number; max: number; now: number } | null {
  const bar = player.querySelector('.ytp-progress-bar');
  if (!bar) return null;
  const min = Number(bar.getAttribute('aria-valuemin'));
  const max = Number(bar.getAttribute('aria-valuemax'));
  const nowRaw = Number(bar.getAttribute('aria-valuenow'));
  const now = Number.isFinite(nowRaw) ? nowRaw : max;
  if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(now) || max <= min) return null;
  return { min, max, now };
}

const youtubeWallOffsets = new WeakMap<HTMLVideoElement, number>();

function rememberYoutubeWallOffset(video: HTMLVideoElement, offset: number): void {
  youtubeWallOffsets.set(video, offset);
  try {
    video.dataset.teYtWallOffset = String(offset);
  } catch {
    // Some test doubles are not real elements.
  }
}

function youtubeWallOffset(video: HTMLVideoElement, times: { min: number; max: number; now: number }): number | null {
  const html5Now = video.currentTime;
  if (!Number.isFinite(html5Now)) return null;
  const atLiveHead = hostIsAtLiveHead(video);
  const ariaBehind = times.max - times.now;
  const liveNow = atLiveHead ? times.max : times.now;
  const measured = liveNow - html5Now;
  if (atLiveHead || ariaBehind > LIVE_EDGE_SECONDS) {
    rememberYoutubeWallOffset(video, measured);
    return measured;
  }
  const remembered = youtubeWallOffsets.get(video);
  if (Number.isFinite(remembered)) return remembered as number;
  try {
    const stored = Number(video.dataset.teYtWallOffset);
    if (Number.isFinite(stored)) return stored;
  } catch {
    // Ignore dataset on test doubles.
  }
  return measured;
}

function youtubeDvrBounds(video: HTMLVideoElement): { start: number; end: number } | null {
  const player = youtubePlayerFor(video);
  if (!player) return null;
  const times = youtubeProgressTimes(player);
  if (!times) return null;
  const offset = youtubeWallOffset(video, times);
  if (offset == null || !Number.isFinite(offset)) return null;
  const start = times.min - offset;
  const end = times.max - offset;
  const span = end - start;
  if (!Number.isFinite(start) || !Number.isFinite(end) || span < MIN_LIVE_DVR_SECONDS || span > MAX_LIVE_DVR_SECONDS) {
    return null;
  }
  return { start, end };
}

function youtubeLiveHeadBounds(video: HTMLVideoElement): { start: number; end: number } | null {
  if (!hostIsAtLiveHead(video)) return null;
  const end = video.currentTime;
  if (!Number.isFinite(end) || end <= 0) return null;
  const start = 0;
  const span = end - start;
  if (span < MIN_LIVE_DVR_SECONDS || span > MAX_LIVE_DVR_SECONDS) return null;
  return { start, end };
}

export function hostLiveHint(video: HTMLVideoElement): boolean {
  const player = youtubePlayerFor(video);
  if (!player) return false;
  try {
    if (player.getVideoData?.()?.isLive === true) return true;
  } catch {
    // Player API may throw before the embed is ready.
  }
  if (player.classList.contains('ytp-livebadge-color')) return true;
  const badge = player.querySelector('.ytp-live-badge');
  return Boolean(badge && (badge as HTMLElement).offsetParent !== null);
}

export function hostIsAtLiveHead(video: HTMLVideoElement): boolean {
  const player = youtubePlayerFor(video);
  const badge = player?.querySelector('.ytp-live-badge');
  return Boolean(badge && badge.classList.contains('ytp-live-badge-is-livehead'));
}

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
  const youtubeDvr = youtubeDvrBounds(video);
  if (youtubeDvr) return boundsWindow(youtubeDvr);
  const youtubeHead = youtubeLiveHeadBounds(video);
  if (youtubeHead) return boundsWindow(youtubeHead);
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

export function playbackWindow(
  video: HTMLVideoElement,
  options?: PlaybackWindowOptions
): PlaybackWindow {
  const live = options?.live ?? hostLiveHint(video);
  if (live) return liveWindow(video);

  const duration = finiteDuration(video);
  if (duration != null) {
    return {
      start: 0,
      end: duration,
      duration,
      seekable: true,
      live: false
    };
  }

  return liveWindow(video);
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

export function isVideoAtLiveEdge(video: HTMLVideoElement, window?: PlaybackWindow): boolean {
  if (hostIsAtLiveHead(video)) return true;
  return isAtLiveEdge(video.currentTime || 0, window ?? playbackWindow(video));
}

function requestYoutubeLiveSeek(detail: MediaSeekDetail): boolean {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return false;
  window.dispatchEvent(new CustomEvent(MEDIA_SEEK_EVENT, { detail }));
  return true;
}

function canSeekYoutubeLive(video: HTMLVideoElement): boolean {
  return hostLiveHint(video) && Boolean(youtubePlayerFor(video));
}

export function seekToMediaTime(video: HTMLVideoElement, time: number): void {
  const window = playbackWindow(video);
  const target = window.seekable ? clampToWindow(time, window) : time;
  if (canSeekYoutubeLive(video)) {
    if (window.live && isAtLiveEdge(target, window)) {
      if (requestYoutubeLiveSeek({ live: true })) return;
    } else if (requestYoutubeLiveSeek({ time: target })) {
      return;
    }
  }
  video.currentTime = target;
}

export function seekToLive(video: HTMLVideoElement): boolean {
  const window = playbackWindow(video);
  if (!window.live) return false;
  if (canSeekYoutubeLive(video) && requestYoutubeLiveSeek({ live: true })) return true;
  if (!window.seekable) return false;
  video.currentTime = window.end;
  return true;
}

export function seekBy(video: HTMLVideoElement, delta: number): boolean {
  const window = playbackWindow(video);
  if (!window.seekable) return false;
  seekToMediaTime(video, (video.currentTime || 0) + delta);
  return true;
}
