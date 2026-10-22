import {
  applyAccentColorPreset,
  DEFAULT_ACCENT_COLOR,
  resolveAccentColorPreset,
  type AccentColorPreset
} from '../accentTheme';
import { raisedCaptionBandMin } from '../media-features/caption-dock';
import { stepLevel } from '../step-level';
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

export const VIDEO_FIT_LABEL_KEYS: Record<VideoFitMode, string> = {
  contain: 'videoFitContain',
  cover: 'videoFitCover',
  fill: 'videoFitFill'
};

/** One fit mode down or up, held at the ends; the cycle shortcut wraps on its own. */
export function stepVideoFitMode(mode: VideoFitMode, direction: 1 | -1): VideoFitMode {
  return stepLevel(VIDEO_FIT_MODES, mode, direction);
}

export function videoFitLabel(mode: VideoFitMode): string {
  return t(VIDEO_FIT_LABEL_KEYS[mode]);
}

export const PICTURE_ALIGN_STORAGE_KEY = 'pictureAlign';
export const PICTURE_ALIGNS = ['center', 'top'] as const;
export type PictureAlign = (typeof PICTURE_ALIGNS)[number];
export const DEFAULT_PICTURE_ALIGN: PictureAlign = 'top';

export const RAISE_ONLY_WITH_SUBTITLES_STORAGE_KEY = 'raiseOnlyWithSubtitles';
export const DEFAULT_RAISE_ONLY_WITH_SUBTITLES = true;

export function resolvePictureAlign(value: unknown): PictureAlign {
  return typeof value === 'string' && PICTURE_ALIGNS.includes(value as PictureAlign)
    ? value as PictureAlign
    : DEFAULT_PICTURE_ALIGN;
}

/** Only a saved boolean overrides the default, so an explicit choice always wins. */
export function resolveRaiseOnlyWithSubtitles(value: unknown): boolean {
  return typeof value === 'boolean' ? value : DEFAULT_RAISE_ONLY_WITH_SUBTITLES;
}

export type PicturePositionOptions = {
  raiseOnlyWithSubtitles?: boolean;
  subtitlesOn?: boolean;
};

/** Raised stays the saved choice. This only decides where the picture sits right now. */
export function effectivePictureAlign(
  align: PictureAlign,
  raiseOnlyWithSubtitles: boolean,
  subtitlesOn: boolean
): PictureAlign {
  if (align === 'top' && raiseOnlyWithSubtitles && !subtitlesOn) return 'center';
  return align;
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

/** Distances from the right and bottom edges of the video box to the visible picture. */
export type PictureEdgeInsets = { end: number; bottom: number };

/**
 * Where the fitted picture ends inside its video box, matching the box's `object-fit`
 * and the vertical keyword of `object-position`. Fill, Stretch and unknown sizes
 * reach the box edges, so the rect is the box.
 */
export function pictureEdgeInsets(frame: PictureFrame, fit: VideoFitMode, position: string): PictureEdgeInsets {
  const { videoWidth, videoHeight, viewportWidth: width, viewportHeight: height } = frame;
  if (fit !== 'contain' || !(videoWidth > 0 && videoHeight > 0 && width > 0 && height > 0)) return { end: 0, bottom: 0 };
  const scale = Math.min(width / videoWidth, height / videoHeight);
  const slackX = Math.max(0, width - videoWidth * scale);
  const slackY = Math.max(0, height - videoHeight * scale);
  return { end: slackX / 2, bottom: position.includes('top') ? slackY : slackY / 2 };
}

/**
 * A fitted picture leaves a usable bar when the viewport is taller than the video
 * by at least one caption line plus its padding and edge gap. A sliver stays
 * centered. Unknown sizes keep the stored Raised choice until measured.
 */
export function pictureHasLetterbox(frame: PictureFrame): boolean {
  const { videoWidth, videoHeight, viewportWidth, viewportHeight } = frame;
  if (!(videoWidth > 0 && videoHeight > 0 && viewportWidth > 0 && viewportHeight > 0)) return true;
  return horizontalLetterboxPx(frame) >= raisedCaptionBandMin();
}

/** Caption chrome follows a measured band that can hold one row. An unmeasured frame can stay `center top` without that treatment. */
export function raisedCaptionsUseBand(position: string, bandHeight: number): boolean {
  return position === 'center top' && bandHeight >= raisedCaptionBandMin();
}

/** Letterbox alignment inside a full-viewport video box. Fill, stretch, and a window without a bottom bar stay centered. */
export function objectPositionForPicture(
  fit: VideoFitMode,
  align: PictureAlign,
  frame?: PictureFrame,
  options?: PicturePositionOptions
): string {
  const effective = effectivePictureAlign(
    align,
    options?.raiseOnlyWithSubtitles === true,
    options?.subtitlesOn === true
  );
  if (fit === 'contain' && effective === 'top' && (!frame || pictureHasLetterbox(frame))) return 'center top';
  return 'center center';
}
