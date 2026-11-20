import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';

import { ACCENT_COLOR_OPTIONS } from '../accentTheme';
import { accentForeground, contrastRatio, contrastSafeAccent } from '../contrast';

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

it('labels the Open channel link in the accent\'s own foreground at WCAG AA for every preset', () => {
  assert.match(CSS, /\.theater-byline-open \{[^}]*background: var\(--accent-color[^}]*color: var\(--accent-text/);
  for (const accent of ACCENT_COLOR_OPTIONS.filter(option => option.preset !== 'system')) {
    for (const swatch of [accent.swatch, contrastSafeAccent(accent.swatch)]) {
      const ratio = contrastRatio(accentForeground(swatch), swatch);
      assert.ok(ratio >= 4.5, `${accent.preset} ${swatch}: ${ratio.toFixed(2)}:1`);
    }
  }
});
