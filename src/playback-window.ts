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

type YoutubePlayerHost = HTMLElement & {
  getVideoData?: () => { isLive?: boolean } | null;
};

function youtubePlayerFor(video: HTMLVideoElement): YoutubePlayerHost | null {
  if (typeof video.closest !== 'function') return null;
  const closest = video.closest('#movie_player, .html5-video-player');
  if (!closest || typeof (closest as Element).querySelector !== 'function') return null;
  return closest as YoutubePlayerHost;
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

function liveWindow(video: HTMLVideoElement): PlaybackWindow {
  const bounds = seekableBounds(video);
  if (bounds) {
    return {
      start: bounds.start,
      end: bounds.end,
      duration: bounds.end - bounds.start,
      seekable: true,
      live: true
    };
  }
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

export function seekBy(video: HTMLVideoElement, delta: number): boolean {
  const window = playbackWindow(video);
  if (!window.seekable) return false;
  video.currentTime = clampToWindow((video.currentTime || 0) + delta, window);
  return true;
}
