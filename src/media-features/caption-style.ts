import { clampNumber } from './sanitize';

export const CAPTION_STYLE_STORAGE_KEY = 'captionStyle';

export const CAPTION_FONT_SCALES = [0.5, 1, 1.5, 2, 3, 4] as const;

export const CAPTION_FONT_PRESETS = [
  { id: 'system', family: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' },
  { id: 'humanist', family: '"Trebuchet MS", "Segoe UI", sans-serif' },
  { id: 'serif', family: 'Georgia, "Times New Roman", serif' },
  { id: 'book', family: 'Palatino, "Book Antiqua", serif' },
  { id: 'mono', family: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }
] as const;

export const CAPTION_TEXT_COLORS = [
  '#ffffff',
  '#141414',
  '#3b66d4',
  '#42d4cf',
  '#82df1b',
  '#fad900',
  '#e50914',
  '#b62db8'
] as const;

export const LEGACY_CAPTION_BACKGROUND_COLOR = '#141414';
export const CAPTION_BACKGROUND_COLORS = [LEGACY_CAPTION_BACKGROUND_COLOR, '#ffffff'] as const;

export type CaptionFontPreset = typeof CAPTION_FONT_PRESETS[number]['id'];

export type CaptionStyle = {
  textColor: string;
  textOpacity: number;
  fontPreset: CaptionFontPreset;
  fontScale: number;
  dropShadow: boolean;
  shadowOpacity: number;
  backgroundColor: string;
  backgroundOpacity: number;
};

export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  textColor: '#fad900',
  textOpacity: 1,
  fontPreset: 'system',
  fontScale: 1,
  dropShadow: true,
  shadowOpacity: 0.92,
  backgroundColor: LEGACY_CAPTION_BACKGROUND_COLOR,
  backgroundOpacity: 0.8
};

const HEX_RE = /^#([0-9a-f]{6})$/i;

export function resolveCaptionStyle(value: unknown): CaptionStyle {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const fontScale = Number(raw.fontScale);
  const textOpacity = Number(raw.textOpacity);
  const shadowOpacity = Number(raw.shadowOpacity);
  const backgroundOpacity = Number(raw.backgroundOpacity);
  return {
    textColor: parseHexColor(raw.textColor, DEFAULT_CAPTION_STYLE.textColor),
    textOpacity: Number.isFinite(textOpacity)
      ? clampNumber(textOpacity, 0, 1)
      : DEFAULT_CAPTION_STYLE.textOpacity,
    fontPreset: resolveCaptionFontPreset(raw.fontPreset),
    fontScale: Number.isFinite(fontScale) ? resolveCaptionFontScale(fontScale) : DEFAULT_CAPTION_STYLE.fontScale,
    dropShadow: typeof raw.dropShadow === 'boolean' ? raw.dropShadow : DEFAULT_CAPTION_STYLE.dropShadow,
    shadowOpacity: Number.isFinite(shadowOpacity)
      ? clampNumber(shadowOpacity, 0, 1)
      : DEFAULT_CAPTION_STYLE.shadowOpacity,
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
  target.style.setProperty('--theater-caption-color', hexToRgba(style.textColor, style.textOpacity));
  target.style.setProperty('--theater-caption-font', captionFontFamily(style.fontPreset));
  target.style.setProperty('--theater-caption-scale', String(style.fontScale));
  target.style.setProperty('--theater-caption-bg', hexToRgba(style.backgroundColor, style.backgroundOpacity));
  target.style.setProperty(
    '--theater-caption-shadow',
    style.dropShadow ? `3px 3px 1px rgba(0, 0, 0, ${style.shadowOpacity})` : 'none'
  );
}

export function resolveCaptionFontPreset(value: unknown): CaptionFontPreset {
  return CAPTION_FONT_PRESETS.some((preset) => preset.id === value)
    ? value as CaptionFontPreset
    : DEFAULT_CAPTION_STYLE.fontPreset;
}

export function captionFontFamily(preset: CaptionFontPreset): string {
  return CAPTION_FONT_PRESETS.find((option) => option.id === preset)?.family
    ?? CAPTION_FONT_PRESETS[0].family;
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
