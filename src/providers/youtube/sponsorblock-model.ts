import type { TimelineMarker } from '../../media-features/types';

// SponsorBlock config.ts barTypes; preview colors deliberately differ from submitted colors.
export const SPONSORBLOCK_COLORS: Readonly<Record<string, string>> = {
  sponsor: '#00d400', selfpromo: '#ffff00', exclusive_access: '#008a5c',
  interaction: '#cc00ff', intro: '#00ffff', outro: '#0202ed', preview: '#008fd6',
  hook: '#395699', music_offtopic: '#ff9900', poi_highlight: '#ff1684',
  filler: '#7300ff', chapter: '#ffd983',
  'preview-chooseACategory': '#ffffff', 'preview-sponsor': '#007800',
  'preview-selfpromo': '#bfbf35', 'preview-interaction': '#6c0087',
  'preview-intro': '#008080', 'preview-outro': '#000070', 'preview-preview': '#005799',
  'preview-hook': '#273963', 'preview-music_offtopic': '#a6634a',
  'preview-poi_highlight': '#9b044c', 'preview-filler': '#2e0066'
};

function percentage(value: string): number | null {
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)%$/.test(value.trim())) return null;
  const number = Number(value.trim().slice(0, -1));
  return Number.isFinite(number) && number >= 0 && number <= 100 ? number / 100 : null;
}

export function sponsorBlockMarker(input: {
  left: string; right: string; category: string; color: string; opacity: string;
}): TimelineMarker | null {
  const start = percentage(input.left);
  const end = input.right ? percentage(input.right) : null;
  if (start === null || (input.right && end === null)) return null;
  const stop = end === null ? start : 1 - end;
  if (stop < start - 1e-9) return null;
  const category = input.category.replace(/^preview-/, '');
  const known = Object.hasOwn(SPONSORBLOCK_COLORS, category);
  const fallbackOpacity = input.category === 'chapter' ? 0
    : input.category === 'filler' ? .9 : input.category === 'hook' ? .8 : .7;
  const opacity = input.opacity.trim() ? Number(input.opacity) : fallbackOpacity;
  const defaultColor = Object.hasOwn(SPONSORBLOCK_COLORS, input.category)
    ? SPONSORBLOCK_COLORS[input.category] : known ? SPONSORBLOCK_COLORS[category] : '#ffffff';
  return {
    start, end: Math.max(start, stop),
    labelKey: known ? `sponsorBlockCategory_${category}` : 'sponsorBlockCategory_unknown',
    color: input.color || defaultColor,
    opacity: Number.isFinite(opacity) ? Math.max(0, Math.min(1, opacity)) : .7
  };
}
