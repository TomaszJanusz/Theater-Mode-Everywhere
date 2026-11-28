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

/** A layer's stops (`color-mix(in srgb, var(<color>, …) 25%, transparent) <position>`, one per line) under the names. */
function sharesUnderNames(layer: 'before' | 'after', color: string): number[] {
  const rule = [...CSS.matchAll(new RegExp(`\\.theater-byline-fill::${layer}\\s*\\{([^}]+)\\}`, 'g'))]
    .map(match => match[1]).find(body => body.includes('linear-gradient'));
  assert.ok(rule, `the ${layer} layer is declared`);
  const stops = rule.split('\n').flatMap(line => {
    const stop = new RegExp(`color-mix\\(in srgb, var\\(${color}[^)]*\\) ([\\d.]+)%, transparent\\) (.+?),?\\)?;?$`).exec(line.trim());
    return stop ? [{ share: Number(stop[1]) / 100, position: stop[2] }] : [];
  });
  assert.ok(stops.length >= 3, `the ${layer} gradient lists its stops`);
  // The names stop --text-end before the apex; the stops after that point are the ramp into the tip.
  assert.match(CSS, /padding-inline: \d+px var\(--text-end\)/);
  const under = stops.filter(({ position }) => position === '0%' || position.includes('var(--text-end)'));
  assert.ok(under.length >= 2, 'stops up to the end of the names are found');
  return under.map(({ share }) => share);
}

/** The accent ramp at rest, whose share under the names is at most 25%. */
const accentUnderNames = () => sharesUnderNames('before', '--accent-color');

/** Hover, focus and open lay the ink over the ramp; under the names its share is the same at every stop. */
function liftUnderNames(): number {
  assert.doesNotMatch(CSS, /\.theater-byline-fill::before\s*\{[^}]*opacity: 0/, 'the accent ramp shows at rest');
  assert.match(CSS, /\.theater-byline-fill::after\s*\{[^}]*opacity: 0/, 'the lift shows only on hover, focus and open');
  const shares = sharesUnderNames('after', '--appearance-ink');
  return Math.max(...shares);
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

it('keeps the author name at WCAG AA (4.5:1) over the accent ramp, at rest and lifted, for every accent preset', () => {
  const shares = accentUnderNames();
  assert.ok(Math.max(...shares) <= 0.25, 'the accent stays at or below 25% under the names');
  const lift = liftUnderNames();
  for (const accent of ACCENTS) {
    // High contrast lifts the accent to its contrast-safe shade.
    for (const [mode, swatch] of [['normal', accent.swatch], ['high contrast', contrastSafeAccent(accent.swatch)]] as const) {
      for (const plate of plates()) for (const [video, picture] of Object.entries(VIDEOS)) for (const share of shares) for (const ink of [0, lift]) {
        const background = hex(over([255, 255, 255], ink, over(rgb(swatch), share, plate.over(picture))));
        const ratio = contrastRatio('#ffffff', background);
        assert.ok(ratio >= 4.5, `${accent.name} (${mode}), ${plate.name}, ${video} video, ${share * 100}% accent, ${ink * 100}% lift: ${ratio.toFixed(2)}:1`);
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


/** The row's own rule, which starts it at rest (the edge is declared with the panel's). */
function rowRule(): string {
  const rule = [...CSS.matchAll(/\n\.theater-byline-row \{([^}]+)\}/g)].map(match => match[1]).find(body => body.includes('--row-fill: transparent'));
  assert.ok(rule, 'the row rule is declared');
  return rule;
}

/** Every tone a row takes (rest, alternate row, hover, press): the ink's share laid over the block's surface. */
function rowTones(): number[] {
  const fills = [...CSS.matchAll(/--row-fill: (.+);/g)].map(match => match[1]);
  assert.ok(fills.length >= 4, 'rest, alternate, hover and press tones are declared');
  return fills.map(fill => {
    if (fill === 'transparent') return 0;
    const share = /^color-mix\(in srgb, var\(--appearance-ink, #[0-9a-f]{6}\) ([\d.]+)%, transparent\)$/.exec(fill);
    assert.ok(share, `a row tone lays the ink over the block: ${fill}`);
    return Number(share[1]) / 100;
  });
}

/**
 * The row's accent ramp over its tone: the largest share anywhere (at its start, under the hover edge) and the largest
 * under the name and its secondary text, which start at `--text-start`. Stops are linear, so the largest share from a
 * point on is the largest stop from there on.
 */
function rowRamp(): { edge: number; text: number } {
  const rule = rowRule();
  // The name starts after the row's padding, its avatar column and the gap.
  assert.match(rule, /--text-start: 64px;/);
  assert.match(rule, /grid-template-columns: 40px /);
  assert.match(rule, /gap: 12px;/);
  assert.match(rule, /padding: 12px;/);
  assert.match(rule, /background-color: var\(--row-fill\);\s*background-image: linear-gradient\(var\(--dir\),/, 'the ramp lies over the tone');
  const stops = rule.split('\n').flatMap(line => {
    const stop = /^color-mix\(in srgb, var\(--accent-color, #[0-9a-f]{6}\) ([\d.]+)%, transparent\) (.+?)(?:,|\);)$/.exec(line.trim());
    return stop ? [{ share: Number(stop[1]) / 100, position: stop[2] }] : [];
  });
  assert.deepEqual(stops.map(stop => stop.position), ['0%', 'var(--text-start)', '100%'], 'the ramp runs from the start through the name to the end');
  return { edge: Math.max(...stops.map(stop => stop.share)), text: Math.max(...stops.slice(1).map(stop => stop.share)) };
}

/** The block's surface, the rows' ink and secondary text with no appearance setting, with Reduce transparency and with high contrast. */
function blockModes() {
  const fallback = (rule: string, property: string, source = CSS) => {
    const value = new RegExp(`${rule}[^}]*var\\(${property}, (#[0-9a-f]{6}|rgba\\([^)]+\\))\\)`).exec(source)?.[1];
    assert.ok(value, `${rule} falls back for ${property}`);
    return value;
  };
  const surface = fallback('\\.theater-byline-list \\{', '--appearance-surface');
  const ink = fallback('', '--appearance-ink', rowRule());
  const muted = fallback('\\.theater-byline-row-stat \\{', '--appearance-muted');
  // Both settings swap the glass for the opaque panel; only high contrast also lifts the ink and the secondary text.
  assert.match(TOKENS, /--appearance-surface: var\(--appearance-normal-panel\)/);
  assert.match(TOKENS, /--appearance-surface: var\(--appearance-high-panel\)/);
  return [
    { name: 'default', surface, ink, muted, highContrast: false },
    { name: 'reduced transparency', surface: token('--appearance-normal-panel'), ink, muted, highContrast: false },
    { name: 'high contrast', surface: token('--appearance-high-panel'), ink: token('--appearance-high-text'), muted: token('--appearance-high-secondary'), highContrast: true }
  ];
}

/**
 * A row's background: its accent ramp at `share` over its tone (the ink at `tone` over the block) on the block's surface
 * over the picture. Laying a translucent ink over the composited surface equals premultiplied `color-mix(in srgb, ink
 * share, surface)` over the picture.
 */
function rowFill(accent: Rgb, share: number, ink: Rgb, tone: number, surface: { rgb: Rgb; alpha: number }, picture: Rgb): Rgb {
  return over(accent, share, over(ink, tone, over(surface.rgb, surface.alpha, picture)));
}

/** Every accent a row can take: the presets (the browser's own as white) and the avatar sweep. High contrast takes the contrast-safe shade of each. */
const rowAccents = () => [...ACCENTS.map(accent => ({ name: accent.name, swatch: accent.swatch, preset: true })), ...avatarAccents().map(swatch => ({ name: swatch, swatch, preset: false }))];

it('keeps the row name and its secondary text at WCAG AA on every row tone with every accent, in every appearance mode', () => {
  const tones = rowTones();
  // Alternate rows and the pointer each change the tone.
  assert.equal(new Set(tones).size, tones.length, 'every tone differs');
  const { text } = rowRamp();
  assert.ok(text > 0, 'the ramp reaches under the name');
  for (const mode of blockModes()) for (const accent of rowAccents()) {
    const swatch = rgb(mode.highContrast ? contrastSafeAccent(accent.swatch) : accent.swatch);
    for (const tone of tones) for (const [video, picture] of Object.entries(VIDEOS)) for (const share of [0, text]) {
      const background = hex(rowFill(swatch, share, rgb(mode.ink), tone, color(mode.surface), picture));
      for (const [kind, foreground] of [['name', mode.ink], ['secondary', mode.muted]]) {
        const ratio = contrastRatio(foreground, background);
        assert.ok(ratio >= 4.5, `${mode.name}, ${accent.name}, ${share * 100}% accent, ${tone * 100}% tone, ${video} video, ${kind} text: ${ratio.toFixed(2)}:1`);
      }
    }
  }
});

it('marks the hovered row with its lit edge at 3:1 against the row under it for every accent', () => {
  assert.match(CSS, /a\.theater-byline-row:hover::before \{[^}]*background: var\(--edge\)/);
  // The row declares the edge itself, so its own accent reaches it.
  assert.match(CSS, /\.theater-byline-row \{ --edge:/);
  const edge = /--edge: color-mix\(in srgb, var\(--accent-color, #[0-9a-f]{6}\) ([\d.]+)%, var\(--appearance-ink, #[0-9a-f]{6}\)\)/.exec(CSS);
  assert.ok(edge, 'the lit edge lifts the accent towards the ink');
  const share = Number(edge[1]) / 100;
  const ramp = rowRamp();
  const modes = blockModes();
  // `system` is the browser's own accent; the lifted tone remains the hover cue there.
  for (const accent of rowAccents().filter(option => option.name !== 'system')) {
    for (const mode of [modes[0], modes[1], modes[2]]) {
      const swatch = rgb(mode.highContrast ? contrastSafeAccent(accent.swatch) : accent.swatch);
      const rim = hex(over(swatch, share, rgb(mode.ink)));
      for (const tone of rowTones()) for (const [video, picture] of Object.entries(VIDEOS)) for (const under of [0, ramp.edge]) {
        const ratio = contrastRatio(rim, hex(rowFill(swatch, under, rgb(mode.ink), tone, color(mode.surface), picture)));
        assert.ok(ratio >= 3, `${accent.name} (${mode.name}), ${under * 100}% accent, ${tone * 100}% tone, ${video} video: ${ratio.toFixed(2)}:1`);
      }
    }
  }
});

it('keeps the names at WCAG AA over the accent ramp and the lit tip at 3:1 on the plate around it for every avatar accent', () => {
  const shares = accentUnderNames();
  const lift = liftUnderNames();
  const edge = /--edge: color-mix\(in srgb, var\(--accent-color, #[0-9a-f]{6}\) ([\d.]+)%, var\(--appearance-ink, (#[0-9a-f]{6})\)\)/.exec(CSS);
  assert.ok(edge, 'the lit edge lifts the accent towards the ink');
  for (const accent of avatarAccents()) {
    // High contrast takes the accent's contrast-safe shade with the high-contrast ink, as it does for the user's accent.
    for (const [mode, swatch] of [['normal', accent], ['high contrast', contrastSafeAccent(accent)]] as const) {
      const rim = over(rgb(swatch), Number(edge[1]) / 100, rgb(edge[2]));
      for (const plate of plates()) for (const [video, picture] of Object.entries(VIDEOS)) {
        for (const share of shares) for (const ink of [0, lift]) {
          const ratio = contrastRatio('#ffffff', hex(over([255, 255, 255], ink, over(rgb(swatch), share, plate.over(picture)))));
          assert.ok(ratio >= 4.5, `${accent} (${mode}), ${plate.name}, ${video} video, ${share * 100}% accent, ${ink * 100}% lift: ${ratio.toFixed(2)}:1`);
        }
        // The lit edge outlines the arrowhead against the plate it points into.
        const ratio = contrastRatio(hex(rim), hex(plate.over(picture)));
        assert.ok(ratio >= 3, `${accent} (${mode}) lit tip, ${plate.name}, ${video} video: ${ratio.toFixed(2)}:1`);
      }
    }
  }
});
