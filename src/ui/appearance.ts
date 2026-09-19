import {
  applyAccentColorPreset,
  DEFAULT_ACCENT_COLOR,
  resolveAccentColorPreset,
  type AccentColorPreset
} from '../accentTheme';
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
