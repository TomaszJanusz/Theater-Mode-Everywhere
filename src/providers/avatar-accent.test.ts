import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { relativeLuminance } from '../contrast';

import { avatarAccent, dominantColor, legibleAccent, type Rgb } from './avatar-accent';

type Rgba = readonly [number, number, number, number];
/** A 24×24 avatar (the size it is read at) painted with `share` parts of each color, in order. */
function avatar(...parts: Array<[Rgba, number]>): Uint8ClampedArray {
  const total = parts.reduce((sum, [, share]) => sum + share, 0);
  const pixels: number[] = [];
  for (const [color, share] of parts) {
    for (let index = 0; index < Math.round(576 * share / total); index++) pixels.push(...color);
  }
  return Uint8ClampedArray.from(pixels);
}
const opaque = ([r, g, b]: Rgb): Rgba => [r, g, b, 255];
const hueOf = (hex: string) => {
  const [r, g, b] = hex.slice(1).match(/../g)!.map(channel => parseInt(channel, 16));
  const max = Math.max(r, g, b), chroma = max - Math.min(r, g, b);
  let sector = (r - g) / chroma + 4;
  if (max === r) sector = (g - b) / chroma + 6;
  else if (max === g) sector = (b - r) / chroma + 2;
  return (sector % 6) * 60;
};

describe('dominantColor', () => {
  it('takes a solid color as it is', () => {
    assert.deepEqual(dominantColor(avatar([opaque([200, 40, 40]), 1])), [200, 40, 40]);
  });

  it('ignores gray, near-white, near-black and transparent pixels around a colored mark', () => {
    const color = dominantColor(avatar(
      [opaque([250, 250, 250]), 4], [opaque([12, 12, 12]), 3], [opaque([128, 128, 132]), 2], [[30, 200, 90, 0], 4], [opaque([30, 160, 220]), 1]
    ));
    assert.deepEqual(color, [30, 160, 220]);
  });

  it('picks the most populated hue and averages within it', () => {
    const color = dominantColor(avatar([opaque([220, 40, 40]), 2], [opaque([220, 40, 160]), 2], [opaque([40, 80, 220]), 3]));
    assert.deepEqual(color, [40, 80, 220]);
    const reds = dominantColor(avatar([opaque([220, 40, 40]), 2], [opaque([200, 60, 40]), 2], [opaque([40, 80, 220]), 1]));
    assert.deepEqual(reds, [210, 50, 40]);
  });

  it('gives none for gray, black-and-white or transparent avatars and for a few stray colored pixels', () => {
    assert.equal(dominantColor(avatar([opaque([128, 128, 128]), 1])), null);
    assert.equal(dominantColor(avatar([opaque([255, 255, 255]), 1], [opaque([0, 0, 0]), 1])), null);
    assert.equal(dominantColor(avatar([[255, 0, 0, 0], 1])), null);
    assert.equal(dominantColor(avatar([opaque([245, 245, 245]), 96], [opaque([220, 30, 30]), 4])), null);
    assert.equal(dominantColor(new Uint8ClampedArray()), null);
  });
});

describe('legibleAccent', () => {
  it('keeps the hue and brings the luminance into the presets\' band', () => {
    for (const [color, hue] of [[[9, 19, 55], 226], [[255, 230, 0], 54], [[0, 108, 50], 148], [[255, 0, 0], 0]] as const) {
      const accent = legibleAccent(color)!;
      assert.match(accent, /^#[0-9a-f]{6}$/);
      assert.ok(Math.abs(hueOf(accent) - hue) < 4, `${accent} keeps the hue of ${color.join(',')}`);
      const y = relativeLuminance(accent);
      assert.ok(y >= 0.155 && y <= 0.505, `${accent} luminance ${y.toFixed(3)}`);
    }
  });

  it('leaves a color already in range nearly as it is', () => {
    assert.equal(legibleAccent([55, 146, 200]), '#3792c7');
  });

  it('gives none for a color without a hue to keep', () => {
    assert.equal(legibleAccent([120, 120, 124]), null);
  });
});

describe('avatarAccent', () => {
  it('turns pixels into the plate accent, or none for a gray avatar', () => {
    assert.equal(avatarAccent(avatar([opaque([250, 250, 250]), 1], [opaque([55, 146, 200]), 1])), '#3792c7');
    assert.equal(avatarAccent(avatar([opaque([200, 200, 200]), 1])), null);
  });
});

describe('recorded avatars', () => {
  const recorded = JSON.parse(readFileSync(new URL('../../test/host-fixtures/author-avatars.json', import.meta.url), 'utf8')) as {
    avatars: Array<{ provider: string; channel: string; accent: string | null; rgba24: string }>;
  };

  it('gives the accent the installed extension applied on the live page', () => {
    assert.ok(recorded.avatars.length >= 8);
    for (const avatar of recorded.avatars) {
      const pixels = Uint8ClampedArray.from(Buffer.from(avatar.rgba24, 'base64'));
      assert.equal(pixels.length, 24 * 24 * 4);
      assert.equal(avatarAccent(pixels), avatar.accent, `${avatar.provider}: ${avatar.channel}`);
    }
  });
});
