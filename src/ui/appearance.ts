import {
  applyAccentColorPreset,
  DEFAULT_ACCENT_COLOR,
  resolveAccentColorPreset,
  type AccentColorPreset
} from '../accentTheme';
import { raisedCaptionBandMin } from '../media-features/caption-dock';
import { t } from './messages';

export { applyAccentColorPreset, DEFAULT_ACCENT_COLOR, resolveAccentColorPreset };
export type { AccentColorPreset };

export const VIDEO_FIT_STORAGE_KEY = 'videoFitMode';
export const VIDEO_FIT_MODES = ['contain', 'cover', 'fill'] as const;
export type VideoFitMode = (typeof VIDEO_FIT_MODES)[number];
export const DEFAULT_VIDEO_FIT: VideoFitMode = 'contain';

export function resolveVideoFitMode(value: unknown): VideoFitMode {
  return typeof value === 'string' && VIDEO_FIT_MODES.includes(value as VideoFitMode)
    ? value as VideoFitMode
    : DEFAULT_VIDEO_FIT;
}

export function videoFitLabel(mode: VideoFitMode): string {
  if (mode === 'cover') return t('videoFitCover');
  if (mode === 'fill') return t('videoFitFill');
  return t('videoFitContain');
}

export const PICTURE_ALIGN_STORAGE_KEY = 'pictureAlign';
export const PICTURE_ALIGNS = ['center', 'top'] as const;
export type PictureAlign = (typeof PICTURE_ALIGNS)[number];
export const DEFAULT_PICTURE_ALIGN: PictureAlign = 'center';

export function resolvePictureAlign(value: unknown): PictureAlign {
  return typeof value === 'string' && PICTURE_ALIGNS.includes(value as PictureAlign)
    ? value as PictureAlign
    : DEFAULT_PICTURE_ALIGN;
}

export type PictureFrame = {
  videoWidth: number;
  videoHeight: number;
  viewportWidth: number;
  viewportHeight: number;
};

/** Height of the horizontal bar under a fitted picture. Unknown sizes report no measurable band. */
export function horizontalLetterboxPx(frame: PictureFrame): number {
  const { videoWidth, videoHeight, viewportWidth, viewportHeight } = frame;
  if (!(videoWidth > 0 && videoHeight > 0 && viewportWidth > 0 && viewportHeight > 0)) return 0;
  const fittedHeight = viewportWidth * videoHeight / videoWidth;
  return Math.max(0, viewportHeight - fittedHeight);
}

/**
 * A fitted picture leaves a usable bar when the viewport is taller than the video
 * by at least one minimum caption block. A sliver stays centered so captions do
 * not cover the picture. Unknown sizes keep the stored Raised choice until measured.
 */
export function pictureHasLetterbox(frame: PictureFrame): boolean {
  const { videoWidth, videoHeight, viewportWidth, viewportHeight } = frame;
  if (!(videoWidth > 0 && videoHeight > 0 && viewportWidth > 0 && viewportHeight > 0)) return true;
  return horizontalLetterboxPx(frame) >= raisedCaptionBandMin();
}

/** Caption chrome follows a measured band that can hold the block. An unmeasured frame can stay `center top` without that treatment. */
export function raisedCaptionsUseBand(position: string, bandHeight: number): boolean {
  return position === 'center top' && bandHeight >= raisedCaptionBandMin();
}

/** Letterbox alignment inside a full-viewport video box. Fill, stretch, and a window without a bottom bar stay centered. */
export function objectPositionForPicture(
  fit: VideoFitMode,
  align: PictureAlign,
  frame?: PictureFrame
): string {
  if (fit === 'contain' && align === 'top' && (!frame || pictureHasLetterbox(frame))) return 'center top';
  return 'center center';
}
