import { mediaHasSource } from './host-play';

/** Hosts that inject extra <video> elements that are not real page players. */
export const AUXILIARY_VIDEO_HOST_SELECTOR = [
  'ytd-video-preview',
  'ytd-moving-thumbnail-renderer',
  'ytd-miniplayer',
  'ytd-inline-playback-player',
  'ytd-shorts',
  '#inline-player',
  '#inline-preview-player',
  '#shorts-player'
].join(',');

const MIN_SWITCHABLE_EDGE = 80;

function hasDecodedOrMetadata(video: HTMLVideoElement): boolean {
  if (video.videoWidth > 0 && video.videoHeight > 0) return true;
  if (video.readyState >= 1) return true;
  return Number.isFinite(video.duration) && video.duration > 0;
}

function hasUsableVideoBox(video: HTMLVideoElement): boolean {
  const rect = video.getBoundingClientRect();
  const width = Math.max(rect.width || 0, video.clientWidth || 0);
  const height = Math.max(rect.height || 0, video.clientHeight || 0);
  return width >= MIN_SWITCHABLE_EDGE && height >= MIN_SWITCHABLE_EDGE;
}

export function isAuxiliaryTheaterVideo(video: HTMLVideoElement): boolean {
  return Boolean(video.closest(AUXILIARY_VIDEO_HOST_SELECTOR));
}

export function isSwitchableTheaterVideo(video: HTMLVideoElement): boolean {
  if (isAuxiliaryTheaterVideo(video)) return false;
  if (video.closest('[hidden]')) return false;
  if (!mediaHasSource(video)) return false;
  if (!hasDecodedOrMetadata(video)) return false;
  if (!hasUsableVideoBox(video)) return false;
  return true;
}

export function selectSwitchableVideos(
  videos: HTMLVideoElement[],
  current?: HTMLVideoElement | null
): HTMLVideoElement[] {
  const selected = videos.filter((video) => isSwitchableTheaterVideo(video));
  if (current && videos.includes(current) && !selected.includes(current)) {
    return [current, ...selected];
  }
  return selected;
}
