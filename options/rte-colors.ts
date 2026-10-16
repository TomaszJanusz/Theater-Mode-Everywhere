import type { ProviderCapabilities } from '../src/providers/capabilities';

/** The dark base a brand's hues are mixed into for the dimmer gradient stops. */
export const TILE_BASE = '#0b0b0d';

export const hexRgb = (hex: string) => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));
export const luminance = (rgb: readonly number[]) => rgb.reduce((sum, channel, i) => {
  const c = channel / 255;
  return sum + [0.2126, 0.7152, 0.0722][i] * (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
}, 0);
/** `color` at `alpha` over `under`, as the browser composites in sRGB. */
export const over = (color: readonly number[], alpha: number, under: readonly number[]) => color.map((value, i) => alpha * value + (1 - alpha) * under[i]);
const hex = (rgb: readonly number[]) => `#${rgb.map(value => Math.round(value).toString(16).padStart(2, '0')).join('').toUpperCase()}`;

/** Splits a plain palette into roles: near-black colors tint the base, light
 * neutrals are excluded, and the remaining hues form the orbit. */
export function brandRoles(colors: readonly string[]) {
  const dark = colors.find(color => luminance(hexRgb(color)) < 0.03);
  const neutral = (color: string) => { const rgb = hexRgb(color); return Math.max(...rgb) - Math.min(...rgb) < 24; };
  const accents = colors.filter(color => color !== dark && luminance(hexRgb(color)) >= 0.03 && !neutral(color));
  if (accents.length === 0) throw new Error(`Brand palette has no hue: ${colors.join(', ')}`);
  return {
    base: dark ? hex(over(hexRgb(dark), 0.45, hexRgb(TILE_BASE))) : TILE_BASE,
    accents,
  };
}

/** Lift the hue while keeping its chroma: neutral brand highlights must not flash white. */
const cometHead = (accents: readonly string[]) => {
  const rgb = hexRgb(accents[0]);
  const low = Math.min(...rgb), high = Math.max(...rgb);
  return hex(rgb.map(channel => 45 + (channel - low) / (high - low) * 210));
};

/** The brightest color the orbit shows, which sets the worst case under the veil. */
export function brightestStop(colors: readonly string[]): number[] {
  const { accents } = brandRoles(colors);
  return [cometHead(accents), ...accents].map(hexRgb).reduce((best, rgb) => luminance(rgb) > luminance(best) ? rgb : best);
}

/** Two opposite comets keep a rectangle's long sides alive while it orbits.
 * The whole circle is opaque: a dim wash of the first hue joins the comets, so
 * the rotating gradient also colors the tile interior seen through the veil. */
function orbitStops(accents: readonly string[], base: string, head: string): string {
  const tail = 20, core = 2.2, under = hexRgb(base);
  const dim = hex(over(hexRgb(accents[0]), 0.8, under));
  return [25, 75].flatMap(center => {
    const trail = [...accents].reverse();
    return [
      `${dim} ${center - 25}%`,
      ...trail.map((color, i) => `${hex(over(hexRgb(color), 0.75 + 0.25 * (i + 1) / trail.length, under))} ${center - tail + (tail - core) * (i + 1) / trail.length}%`),
      `${head} ${center}%`,
      `${accents[0]} ${center + core}%`,
      `${dim} ${center + 25}%`,
    ];
  }).join(', ');
}

/** One palette-to-CSS boundary; High contrast hides the decoration without provider selectors. */
export function serviceColorProperties(provider: Pick<ProviderCapabilities, 'brandColors'>): Record<string, string> {
  const { base, accents } = brandRoles(provider.brandColors);
  return { '--te-border-stops': orbitStops(accents, base, cometHead(accents)) };
}
