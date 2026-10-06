import { LIVE_EDGE_SECONDS, MAX_LIVE_DVR_SECONDS, MIN_LIVE_DVR_SECONDS } from './limits';
import type { HostSeekDispatch, HostSeekInput, ProviderTimeline, TimelineBounds } from './types';

const YOUTUBE_WALL_OFFSET_RESYNC_SECONDS = 5;

type YoutubePlayerHost = HTMLElement & {
  getVideoData?: () => { isLive?: boolean } | null;
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

function rememberedYoutubeWallOffset(video: HTMLVideoElement): number | null {
  const remembered = youtubeWallOffsets.get(video);
  if (Number.isFinite(remembered)) return remembered as number;
  try {
    const stored = Number(video.dataset.teYtWallOffset);
    if (Number.isFinite(stored)) return stored;
  } catch {
    // Ignore dataset on test doubles.
  }
  return null;
}

function youtubeWallOffset(video: HTMLVideoElement, times: { min: number; max: number; now: number }): number | null {
  const html5Now = video.currentTime;
  if (!Number.isFinite(html5Now)) return null;
  const atLiveHead = youtubeIsAtLiveHead(video);
  const ariaBehind = times.max - times.now;
  const liveNow = atLiveHead ? times.max : times.now;
  const measured = liveNow - html5Now;
  const remembered = rememberedYoutubeWallOffset(video);
  const ariaTrusted = atLiveHead || ariaBehind > LIVE_EDGE_SECONDS;
  if (ariaTrusted) {
    // During an in-flight DVR seek the native thumb can jump before HTML5
    // currentTime does. That pair is not a new mapping — keep the last offset.
    if (
      remembered != null
      && Number.isFinite(measured)
      && Math.abs(measured - remembered) > YOUTUBE_WALL_OFFSET_RESYNC_SECONDS
    ) {
      return remembered;
    }
    rememberYoutubeWallOffset(video, measured);
    return measured;
  }
  if (remembered != null) return remembered;
  return measured;
}

function youtubeDvrBounds(video: HTMLVideoElement): TimelineBounds | null {
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

function youtubeLiveHeadBounds(video: HTMLVideoElement): TimelineBounds | null {
  if (!youtubeIsAtLiveHead(video)) return null;
  const end = video.currentTime;
  if (!Number.isFinite(end) || end <= 0) return null;
  const start = 0;
  const span = end - start;
  if (span < MIN_LIVE_DVR_SECONDS || span > MAX_LIVE_DVR_SECONDS) return null;
  return { start, end };
}

function youtubeLiveHint(video: HTMLVideoElement): boolean {
  const player = youtubePlayerFor(video);
  if (!player) return false;
  try {
    if (player.getVideoData?.()?.isLive === true) return true;
  } catch {
    // Player API may throw before the embed is ready.
  }
  // Do not use ytp-livebadge-color: YouTube applies it to VOD chrome too.
  const badge = player.querySelector('.ytp-live-badge') as HTMLElement | null;
  return Boolean(badge && badge.offsetParent);
}

function youtubeIsAtLiveHead(video: HTMLVideoElement): boolean {
  const player = youtubePlayerFor(video);
  const badge = player?.querySelector('.ytp-live-badge');
  return Boolean(badge && badge.classList.contains('ytp-live-badge-is-livehead'));
}

function canSeekYoutubeLive(video: HTMLVideoElement): boolean {
  return youtubeLiveHint(video) && Boolean(youtubePlayerFor(video));
}

function youtubeMediaSeek(video: HTMLVideoElement, input: HostSeekInput): HostSeekDispatch | null {
  if (!canSeekYoutubeLive(video)) return null;
  if (input.windowLive && input.atLiveEdge) {
    return { detail: { live: true }, rememberResume: false };
  }
  return {
    detail: { time: input.target, resumeAfterSeek: input.resumeAfterSeek },
    rememberResume: true
  };
}

function youtubeLiveSeek(video: HTMLVideoElement): HostSeekDispatch | null {
  if (!canSeekYoutubeLive(video)) return null;
  return { detail: { live: true }, rememberResume: false };
}

export const youtubeTimeline: ProviderTimeline = {
  liveHint: youtubeLiveHint,
  isAtLiveHead: youtubeIsAtLiveHead,
  liveBounds(video) {
    return youtubeDvrBounds(video) ?? youtubeLiveHeadBounds(video);
  },
  mediaSeek: youtubeMediaSeek,
  liveSeek: youtubeLiveSeek
};
