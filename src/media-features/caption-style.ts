import { clampNumber } from './sanitize';

export const CAPTION_STYLE_STORAGE_KEY = 'captionStyle';

export const CAPTION_FONT_SCALES = [0.5, 1, 1.5, 2, 3, 4] as const;

export type CaptionStyle = {
  textColor: string;
  fontScale: number;
  dropShadow: boolean;
  backgroundColor: string;
  backgroundOpacity: number;
};

export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  textColor: '#ffffff',
  fontScale: 1,
  dropShadow: false,
  backgroundColor: '#141414',
  backgroundOpacity: 0.8
};

const HEX_RE = /^#([0-9a-f]{6})$/i;

export function resolveCaptionStyle(value: unknown): CaptionStyle {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const fontScale = Number(raw.fontScale);
  const backgroundOpacity = Number(raw.backgroundOpacity);
  return {
    textColor: parseHexColor(raw.textColor, DEFAULT_CAPTION_STYLE.textColor),
    fontScale: Number.isFinite(fontScale) ? resolveCaptionFontScale(fontScale) : DEFAULT_CAPTION_STYLE.fontScale,
    dropShadow: raw.dropShadow === true,
    backgroundColor: parseHexColor(raw.backgroundColor, DEFAULT_CAPTION_STYLE.backgroundColor),
    backgroundOpacity: Number.isFinite(backgroundOpacity)
      ? clampNumber(backgroundOpacity, 0, 1)
      : DEFAULT_CAPTION_STYLE.backgroundOpacity
  };
}

export function resolveCaptionFontScale(value: number): number {
  const bounded = clampNumber(value, CAPTION_FONT_SCALES[0], CAPTION_FONT_SCALES[CAPTION_FONT_SCALES.length - 1]);
  return CAPTION_FONT_SCALES.reduce((closest, candidate) => (
    Math.abs(candidate - bounded) < Math.abs(closest - bounded) ? candidate : closest
  ));
}

export function stepCaptionFontScale(value: number, direction: 1 | -1): number {
  const current = resolveCaptionFontScale(value);
  const index = CAPTION_FONT_SCALES.indexOf(current as typeof CAPTION_FONT_SCALES[number]);
  return CAPTION_FONT_SCALES[Math.max(0, Math.min(CAPTION_FONT_SCALES.length - 1, index + direction))];
}

export function applyCaptionStyle(target: HTMLElement, style: CaptionStyle): void {
  target.style.setProperty('--theater-caption-color', style.textColor);
  target.style.setProperty('--theater-caption-scale', String(style.fontScale));
  target.style.setProperty('--theater-caption-bg', hexToRgba(style.backgroundColor, style.backgroundOpacity));
  target.style.setProperty(
    '--theater-caption-shadow',
    style.dropShadow ? '0 1px 2px rgba(0, 0, 0, 0.9), 0 0 10px rgba(0, 0, 0, 0.45)' : 'none'
  );
}

function parseHexColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  return HEX_RE.test(value) ? value.toLowerCase() : fallback;
}

function hexToRgba(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
