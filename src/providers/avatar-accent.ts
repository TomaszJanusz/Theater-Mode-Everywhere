import { relativeLuminance } from '../contrast';

/** An sRGB color, 0–255 per channel. */
export type Rgb = readonly [number, number, number];

const HUE_BUCKETS = 12;
/** The winning hue must cover at least this share of the opaque pixels, or the avatar counts as colorless. */
const MIN_SHARE = 0.06;
/** The plate's accent stays within the luminance of the accent presets (gray 0.2 to yellow 0.64), a little narrower. */
const MIN_LUMINANCE = 0.16;
const MAX_LUMINANCE = 0.5;
const MIN_SATURATION = 0.4;
const MAX_SATURATION = 0.9;

/** The hue, 0 to 1, of a color that has one. */
function hue(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b), chroma = max - Math.min(r, g, b);
  let sector: number;
  if (max === r) sector = (g - b) / chroma + 6;
  else if (max === g) sector = (b - r) / chroma + 2;
  else sector = (r - g) / chroma + 4;
  return (sector % 6) / 6;
}

/**
 * The avatar's dominant color from its RGBA pixels: the mean of the most populated hue bucket, ignoring transparent,
 * near-black, near-white and gray pixels. Null when too little of the avatar has a color.
 */
export function dominantColor(pixels: ArrayLike<number>): Rgb | null {
  const counts = new Array<number>(HUE_BUCKETS).fill(0);
  const sums = Array.from({ length: HUE_BUCKETS }, () => [0, 0, 0]);
  let opaque = 0;
  for (let index = 0; index + 3 < pixels.length; index += 4) {
    if (pixels[index + 3] < 128) continue;
    opaque++;
    const r = pixels[index], g = pixels[index + 1], b = pixels[index + 2];
    const max = Math.max(r, g, b), chroma = max - Math.min(r, g, b);
    if (max < 40 || chroma < 32 || chroma < max * 0.15) continue;
    const bucket = Math.floor(hue(r, g, b) * HUE_BUCKETS) % HUE_BUCKETS;
    counts[bucket]++;
    sums[bucket][0] += r; sums[bucket][1] += g; sums[bucket][2] += b;
  }
  const best = counts.indexOf(Math.max(...counts));
  const count = counts[best];
  if (!count || count < opaque * MIN_SHARE) return null;
  return [sums[best][0] / count, sums[best][1] / count, sums[best][2] / count];
}

function hsl([r, g, b]: Rgb): [number, number, number] {
  const max = Math.max(r, g, b), chroma = max - Math.min(r, g, b);
  const lightness = (2 * max - chroma) / 510;
  const saturation = chroma ? chroma / 255 / (1 - Math.abs(2 * lightness - 1)) : 0;
  return [chroma ? hue(r, g, b) : 0, saturation, lightness];
}

function rgb(h: number, s: number, l: number): Rgb {
  const channel = (n: number) => {
    const k = (n + h * 12) % 12;
    return 255 * (l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
  };
  return [channel(0), channel(8), channel(4)];
}

const hex = (color: Rgb) => `#${color.map(channel => Math.round(channel).toString(16).padStart(2, '0')).join('')}`;

/**
 * The color moved into the plate's legible range, as `#rrggbb`: its hue kept, its saturation clamped, its lightness
 * moved until its luminance lies in the accent presets' band, so the names keep their contrast over the hover fill
 * and the lit edge stays clear of the plate (author-byline-contrast.test.ts). Null for a color with no hue to keep.
 */
export function legibleAccent(color: Rgb): string | null {
  const [h, saturation, lightness] = hsl(color);
  if (saturation < 0.15) return null;
  const s = Math.min(MAX_SATURATION, Math.max(MIN_SATURATION, saturation));
  const target = Math.min(MAX_LUMINANCE, Math.max(MIN_LUMINANCE, relativeLuminance(hex(rgb(h, s, lightness)))));
  // Luminance rises with lightness at a fixed hue and saturation.
  let low = 0, high = 1, l = lightness;
  for (let step = 0; step < 20; step++) {
    l = (low + high) / 2;
    if (relativeLuminance(hex(rgb(h, s, l))) < target) low = l;
    else high = l;
  }
  return hex(rgb(h, s, l));
}

/** The plate's accent for an avatar's RGBA pixels, or null to keep the user's accent. */
export function avatarAccent(pixels: ArrayLike<number>): string | null {
  const color = dominantColor(pixels);
  return color && legibleAccent(color);
}
