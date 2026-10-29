import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';

import { contrastRatio } from '../contrast';

const CSS = readFileSync(new URL('./shadow.css', import.meta.url), 'utf8');

/** Chat backgrounds the handle sits on: Twitch and YouTube in light and dark, and the black letterbox. */
const BACKGROUNDS = { twitchLight: '#ffffff', twitchDark: '#18181b', youtubeLight: '#ffffff', youtubeDark: '#0f0f0f', letterbox: '#000000' };

function ringColors(): Array<{ rgb: [number, number, number]; alpha: number }> {
  const ring = /--chat-separator-ring:\s*([^;]+);/.exec(CSS)?.[1];
  assert.ok(ring, 'the separator ring is declared in shadow.css');
  return [...ring.matchAll(/rgb\((\d+) (\d+) (\d+) \/ (\d+)%\)/g)].map(match => ({
    rgb: [Number(match[1]), Number(match[2]), Number(match[3])],
    alpha: Number(match[4]) / 100
  }));
}

function over(color: { rgb: [number, number, number]; alpha: number }, background: string): string {
  const base = background.slice(1).match(/../g)!.map(channel => parseInt(channel, 16));
  return '#' + color.rgb.map((channel, index) => Math.round(channel * color.alpha + base[index] * (1 - color.alpha))
    .toString(16).padStart(2, '0')).join('');
}

it('keeps the separator outline at least 3:1 against light and dark chat, whatever the accent fill', () => {
  const [inner, outer] = ringColors();
  assert.ok(inner && outer, 'the ring has a dark inner and a light outer hairline');
  for (const [name, background] of Object.entries(BACKGROUNDS)) {
    // Box shadows stack outward: the dark hairline touches the fill, the light one the background.
    const outerBand = over(outer, background);
    const innerBand = over(inner, outerBand);
    const best = Math.max(contrastRatio(outerBand, background), contrastRatio(innerBand, outerBand));
    assert.ok(best >= 3, `${name}: ${best.toFixed(2)}:1`);
  }
});
