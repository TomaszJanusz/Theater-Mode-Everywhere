import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';

import { ACCENT_COLOR_OPTIONS } from '../accentTheme';
import { contrastRatio, contrastSafeAccent } from '../contrast';

import { legibleAccent } from './avatar-accent';

const CSS = readFileSync(new URL('./author-byline-view.css', import.meta.url), 'utf8');
const SHADOW = readFileSync(new URL('../ui/shadow.css', import.meta.url), 'utf8');
const TOKENS = readFileSync(new URL('../appearance-tokens.css', import.meta.url), 'utf8');

type Rgb = [number, number, number];
const rgb = (hex: string): Rgb => hex.slice(1).match(/../g)!.map(channel => parseInt(channel, 16)) as Rgb;
const hex = (color: Rgb) => `#${color.map(channel => Math.round(channel).toString(16).padStart(2, '0')).join('')}`;
const over = (color: Rgb, alpha: number, base: Rgb): Rgb => color.map((channel, index) => channel * alpha + base[index] * (1 - alpha)) as Rgb;

/** The hover layer's accent share at each stop that lies under the names: 0% and the fractions of `100% - --text-end`. */
function accentUnderNames(): number[] {
  const rule = [...CSS.matchAll(/\.theater-byline-fill::after\s*\{([^}]+)\}/g)].map(match => match[1]).find(body => body.includes('linear-gradient'));
  assert.ok(rule, 'the hover layer is declared');
  // One stop per line: `color-mix(in srgb, var(--accent-color, …) 25%, transparent) <position>`.
  const stops = rule.split('\n').flatMap(line => {
    const stop = /color-mix\(in srgb, var\(--accent-color[^)]*\) ([\d.]+)%, transparent\) (.+?),?$/.exec(line.trim());
    return stop ? [{ share: Number(stop[1]) / 100, position: stop[2] }] : [];
  });
  assert.ok(stops.length > 10, 'the hover gradient lists its stops');
  const under = stops.filter(({ position }) => position === '0%' || position.includes('var(--text-end)'));
  assert.ok(under.length >= 4, 'stops up to the end of the names are found');
  // The names stop --text-end before the apex; the stops after that point are the ramp into the tip.
  assert.match(CSS, /padding-inline: \d+px var\(--text-end\)/);
  return under.map(({ share }) => share);
}

/** The plate the panel sits on: translucent over the picture normally, opaque with high contrast or reduced transparency. */
function plates(): Array<{ name: string; over: (video: Rgb) => Rgb }> {
  const translucent = /\.theater-hud-plate\s*\{[^}]*rgba\((\d+), (\d+), (\d+), ([\d.]+)\)/.exec(SHADOW);
  const opaque = /--appearance-normal-panel:\s*(#[0-9a-f]{6})/i.exec(TOKENS)?.[1];
  assert.ok(translucent && opaque, 'the plate fills are declared');
  const fill: Rgb = [Number(translucent[1]), Number(translucent[2]), Number(translucent[3])];
  return [
    { name: 'translucent plate', over: video => over(fill, Number(translucent[4]), video) },
    { name: 'opaque plate', over: () => rgb(opaque) }
  ];
}

const VIDEOS: Record<string, Rgb> = { black: [0, 0, 0], gray: [128, 128, 128], white: [255, 255, 255] };
// `system` follows the browser's accent; white is the worst case it could be.
const ACCENTS = ACCENT_COLOR_OPTIONS.map(option => ({ name: option.preset, swatch: option.preset === 'system' ? '#ffffff' : option.swatch }));

it('keeps the author name at WCAG AA (4.5:1) over the hover gradient for every accent preset', () => {
  const shares = accentUnderNames();
  assert.ok(Math.max(...shares) <= 0.25, 'the accent stays at or below 25% under the names');
  for (const accent of ACCENTS) {
    // High contrast lifts the accent to its contrast-safe shade.
    for (const [mode, swatch] of [['normal', accent.swatch], ['high contrast', contrastSafeAccent(accent.swatch)]] as const) {
      for (const plate of plates()) for (const [video, picture] of Object.entries(VIDEOS)) for (const share of shares) {
        const background = hex(over(rgb(swatch), share, plate.over(picture)));
        const ratio = contrastRatio('#ffffff', background);
        assert.ok(ratio >= 4.5, `${accent.name} (${mode}), ${plate.name}, ${video} video, ${share * 100}% accent: ${ratio.toFixed(2)}:1`);
      }
    }
  }
});

/** A CSS color: `#rrggbb` or `rgba(r, g, b, a)`. */
function color(value: string): { rgb: Rgb; alpha: number } {
  const channels = /^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/.exec(value);
  return channels
    ? { rgb: [Number(channels[1]), Number(channels[2]), Number(channels[3])], alpha: Number(channels[4]) }
    : { rgb: rgb(value), alpha: 1 };
}
const token = (name: string) => {
  const value = new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(TOKENS)?.[1];
  assert.ok(value, `${name} is declared`);
  return value;
};

/** Every tone a row takes (rest, alternate row, hover, press): the ink's share laid over the block's surface. */
function rowTones(): number[] {
  const fills = [...CSS.matchAll(/--row-fill: (.+);/g)].map(match => match[1]);
  assert.ok(fills.length >= 4, 'rest, alternate, hover and press tones are declared');
  return fills.map(fill => {
    assert.doesNotMatch(fill, /accent/, 'row tones never take the accent');
    if (fill === 'transparent') return 0;
    const share = /^color-mix\(in srgb, var\(--appearance-ink, #[0-9a-f]{6}\) ([\d.]+)%, transparent\)$/.exec(fill);
    assert.ok(share, `a row tone lays the ink over the block: ${fill}`);
    return Number(share[1]) / 100;
  });
}

/** The block's surface, the rows' ink and secondary text with no appearance setting, with Reduce transparency and with high contrast. */
function blockModes() {
  const fallback = (rule: string, property: string) => {
    const value = new RegExp(`${rule} \\{[^}]*var\\(${property}, (#[0-9a-f]{6}|rgba\\([^)]+\\))\\)`).exec(CSS)?.[1];
    assert.ok(value, `${rule} falls back for ${property}`);
    return value;
  };
  const surface = fallback('\\.theater-byline-list', '--appearance-surface');
  const ink = fallback('\\.theater-byline-row', '--appearance-ink');
  const muted = fallback('\\.theater-byline-row-stat', '--appearance-muted');
  // Both settings swap the glass for the opaque panel; only high contrast also lifts the ink and the secondary text.
  assert.match(TOKENS, /--appearance-surface: var\(--appearance-normal-panel\)/);
  assert.match(TOKENS, /--appearance-surface: var\(--appearance-high-panel\)/);
  return [
    { name: 'default', surface, ink, muted },
    { name: 'reduced transparency', surface: token('--appearance-normal-panel'), ink, muted },
    { name: 'high contrast', surface: token('--appearance-high-panel'), ink: token('--appearance-high-text'), muted: token('--appearance-high-secondary') }
  ];
}

/**
 * A row's tone (the ink at `share` over the block) on the block's surface over the picture. Laying a translucent ink
 * over the composited surface equals premultiplied `color-mix(in srgb, ink share, surface)` over the picture.
 */
function rowFill(ink: Rgb, share: number, surface: { rgb: Rgb; alpha: number }, picture: Rgb): Rgb {
  return over(ink, share, over(surface.rgb, surface.alpha, picture));
}

it('keeps the row name and its secondary text at WCAG AA on every row tone in every appearance mode', () => {
  const tones = rowTones();
  // Alternate rows and the pointer each change the tone.
  assert.equal(new Set(tones).size, tones.length, 'every tone differs');
  for (const mode of blockModes()) for (const tone of tones) for (const [video, picture] of Object.entries(VIDEOS)) {
    const background = hex(rowFill(rgb(mode.ink), tone, color(mode.surface), picture));
    for (const [text, foreground] of [['name', mode.ink], ['secondary', mode.muted]]) {
      const ratio = contrastRatio(foreground, background);
      assert.ok(ratio >= 4.5, `${mode.name}, ${tone * 100}% tone, ${video} video, ${text} text: ${ratio.toFixed(2)}:1`);
    }
  }
});

it('marks the hovered row with the panel\'s lit edge at 3:1 against every row tone for every preset', () => {
  assert.match(CSS, /a\.theater-byline-row:hover::before \{[^}]*background: var\(--edge\)/);
  const edge = /--edge: color-mix\(in srgb, var\(--accent-color, #[0-9a-f]{6}\) ([\d.]+)%, var\(--appearance-ink, #[0-9a-f]{6}\)\)/.exec(CSS);
  assert.ok(edge, 'the lit edge lifts the accent towards the ink');
  const share = Number(edge[1]) / 100;
  const modes = blockModes();
  // `system` is the browser's own accent; the lifted tone remains the hover cue there.
  for (const accent of ACCENT_COLOR_OPTIONS.filter(option => option.preset !== 'system')) {
    for (const [mode, swatch] of [[modes[0], accent.swatch], [modes[2], contrastSafeAccent(accent.swatch)]] as const) {
      for (const tone of rowTones()) for (const [video, picture] of Object.entries(VIDEOS)) {
        const rim = hex(over(rgb(swatch), share, rgb(mode.ink)));
        const ratio = contrastRatio(rim, hex(rowFill(rgb(mode.ink), tone, color(mode.surface), picture)));
        assert.ok(ratio >= 3, `${accent.preset} (${mode.name}), ${tone * 100}% tone, ${video} video: ${ratio.toFixed(2)}:1`);
      }
    }
  }
});

/** Avatar colors across the wheel, from dark to pale and from muted to vivid, as `legibleAccent` places them. */
function avatarAccents(): string[] {
  const accents = new Set<string>();
  for (let hue = 0; hue < 360; hue += 10) for (const saturation of [0.3, 0.6, 1]) for (const lightness of [0.08, 0.3, 0.5, 0.7, 0.92]) {
    const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
    const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
    const [r, g, b] = [[chroma, x, 0], [x, chroma, 0], [0, chroma, x], [0, x, chroma], [x, 0, chroma], [chroma, 0, x]][Math.floor(hue / 60)];
    const m = lightness - chroma / 2;
    const accent = legibleAccent([(r + m) * 255, (g + m) * 255, (b + m) * 255]);
    if (accent) accents.add(accent);
  }
  assert.ok(accents.size > 300, 'the sweep yields many accents');
  return [...accents];
}

it('keeps the names at WCAG AA over the hover gradient and the lit tip at 3:1 on the plate for every avatar accent', () => {
  const shares = accentUnderNames();
  const edge = /--edge: color-mix\(in srgb, var\(--accent-color, #[0-9a-f]{6}\) ([\d.]+)%, var\(--appearance-ink, (#[0-9a-f]{6})\)\)/.exec(CSS);
  assert.ok(edge, 'the lit edge lifts the accent towards the ink');
  // At rest the tip lies under the black ramp's last stop, which the rest layer declares as its 100% stop.
  const tip = /rgb\(0 0 0 \/ ([\d.]+)\) calc\(100% - 0px\)\);/.exec(CSS);
  assert.ok(tip, 'the rest layer ends at the apex');
  for (const accent of avatarAccents()) {
    // High contrast takes the accent's contrast-safe shade with the high-contrast ink, as it does for the user's accent.
    for (const [mode, swatch] of [['normal', accent], ['high contrast', contrastSafeAccent(accent)]] as const) {
      const rim = over(rgb(swatch), Number(edge[1]) / 100, rgb(edge[2]));
      for (const plate of plates()) for (const [video, picture] of Object.entries(VIDEOS)) {
        for (const share of shares) {
          const ratio = contrastRatio('#ffffff', hex(over(rgb(swatch), share, plate.over(picture))));
          assert.ok(ratio >= 4.5, `${accent} (${mode}), ${plate.name}, ${video} video, ${share * 100}% accent: ${ratio.toFixed(2)}:1`);
        }
        const ratio = contrastRatio(hex(rim), hex(over([0, 0, 0], Number(tip[1]), plate.over(picture))));
        assert.ok(ratio >= 3, `${accent} (${mode}) lit tip, ${plate.name}, ${video} video: ${ratio.toFixed(2)}:1`);
      }
    }
  }
});
