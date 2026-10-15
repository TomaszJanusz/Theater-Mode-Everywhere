import type { ProviderCapabilities } from '../src/providers/capabilities';

/** The dark tile base; a brand's own dark color only tints it. */
export const TILE_BASE = '#0b0b0d';
/** Each corner's glow plus the rim may raise the surface under it at most to
 * this luminance, so bright cyan and deep red read equally vivid while text
 * contrast stays bounded. The ring is the brand color mixed into the base. */
export const TILE_LEVELS = {
  on: { peak: 0.08, ring: 0.9 },
  off: { peak: 0.03, ring: 0.45 },
} as const;
/** The rim's share of a corner's peak opacity; the radial glow supplies the rest. */
export const RIM_SHARE = 0.35;

export const hexRgb = (hex: string) => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));
export const luminance = (rgb: readonly number[]) => rgb.reduce((sum, channel, i) => {
  const c = channel / 255;
  return sum + [0.2126, 0.7152, 0.0722][i] * (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
}, 0);
/** `color` at `alpha` over `under`, as color-mix(... transparent) composites in sRGB. */
export const over = (color: readonly number[], alpha: number, under: readonly number[]) => color.map((value, i) => alpha * value + (1 - alpha) * under[i]);
const hex = (rgb: readonly number[]) => `#${rgb.map(value => Math.round(value).toString(16).padStart(2, '0')).join('').toUpperCase()}`;

/** Splits a plain palette into roles: near-black colors tint the base, light
 * neutrals become the ring highlight, and the remaining hues glow. */
export function brandRoles(colors: readonly string[]) {
  const dark = colors.find(color => luminance(hexRgb(color)) < 0.03);
  const neutral = (color: string) => { const rgb = hexRgb(color); return Math.max(...rgb) - Math.min(...rgb) < 24; };
  const accents = colors.filter(color => color !== dark && luminance(hexRgb(color)) >= 0.03 && !neutral(color));
  if (accents.length === 0) throw new Error(`Brand palette has no hue: ${colors.join(', ')}`);
  return {
    base: dark ? hex(over(hexRgb(dark), 0.45, hexRgb(TILE_BASE))) : TILE_BASE,
    accents,
    highlight: colors.find(color => color !== dark && neutral(color) && luminance(hexRgb(color)) >= 0.03),
  };
}

/** The highest opacity, at most 0.85, whose composite stays within `peak` luminance. */
function fitAlpha(composite: (alpha: number) => readonly number[], peak: number): number {
  let low = 0, high = 0.85;
  for (let step = 0; step < 16; step++) {
    const mid = (low + high) / 2;
    if (luminance(composite(mid)) <= peak) low = mid; else high = mid;
  }
  return low;
}

// Rounds down, so the rendered opacity never exceeds the fitted one.
const alpha = (color: string, amount: number) => `color-mix(in srgb, ${color} ${Math.floor(amount * 1000) / 10}%, transparent)`;

/** A bright head led by the first hue, trailing through the others; two
 * opposite comets keep a rectangle's long sides alive while it orbits. */
function cometStops(accents: readonly string[], head: string): string {
  const tail = 17, core = 2.2;
  return [25, 75].flatMap(center => {
    const trail = [...accents].reverse();
    return [
      `transparent ${center - tail}%`,
      ...trail.map((color, i) => `${alpha(color, 0.3 + 0.6 * (i + 1) / trail.length)} ${center - tail + (tail - core) * (i + 1) / trail.length}%`),
      `${head} ${center}%`,
      `${alpha(accents[0], 0.8)} ${center + core}%`,
      `transparent ${center + core * 2.5}%`,
    ];
  }).join(', ');
}

/** Opacities of the two corner glows and the shared rim (in the first hue):
 * each corner, glow under rim, peaks at `peak` luminance. */
export function tileGlows(accents: readonly string[], base: string, peak: number) {
  const [first, second = first] = accents;
  // The rim is the first hue; size it on its own corner, then fit each glow under it.
  const rim = fitAlpha(value => over(hexRgb(first), value, hexRgb(base)), peak) * RIM_SHARE;
  const glows = [first, second].map(color => fitAlpha(value => over(hexRgb(first), rim, over(hexRgb(color), value, hexRgb(base))), peak));
  return { glows, rim };
}

/** One palette-to-CSS boundary. TME-48's data-contrast="high" and
 * data-transparency="reduced" hooks can flatten every tile by overriding these
 * properties and hiding .te-animated-border::before, without provider selectors. */
export function serviceColorProperties(provider: Pick<ProviderCapabilities, 'brandColors'>): Record<string, string> {
  const { base, accents, highlight } = brandRoles(provider.brandColors);
  const [first, second = first] = accents;
  const properties: Record<string, string> = {
    '--te-border-stops': cometStops(accents, highlight ?? `color-mix(in srgb, ${first} 45%, white)`),
  };
  for (const [state, level] of Object.entries(TILE_LEVELS)) {
    const suffix = state === 'on' ? '' : '-off';
    const { glows, rim } = tileGlows(accents, base, level.peak);
    // Glows enter from opposite corners and along the rim, fading toward the
    // center. Each fades out before the opposite corner and the two sum to less
    // than one full glow anywhere, so the corners bound the surface luminance.
    const ring = accents.map(color => `color-mix(in srgb, ${color} ${Math.round(level.ring * 100)}%, ${base})`);
    properties[`--rte-background${suffix}`] = [
      `radial-gradient(120% 160% at 0% 0%, ${alpha(first, glows[0])}, transparent 75%) padding-box`,
      `radial-gradient(120% 160% at 100% 100%, ${alpha(second, glows[1])}, transparent 75%) padding-box`,
      `linear-gradient(${base}, ${base}) padding-box`,
      `linear-gradient(135deg, ${(ring.length === 1 ? [ring[0], ring[0]] : ring).join(', ')}) border-box`,
    ].join(', ');
    properties[`--rte-rim${suffix}`] = `inset 0 0 28px -8px ${alpha(first, rim)}`;
  }
  return properties;
}
