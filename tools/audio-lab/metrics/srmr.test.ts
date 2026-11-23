import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { syntheticMaterial } from '../synthetic';

import { describeFrames, speechInDryVoice } from './frames';
import { HOP, powerGrid } from './grid';
import { srmr } from './srmr';

describe('audio lab: SRMR', () => {
  const values = new Map<string, number>();
  const of = (id: string) => {
    if (!values.has(id)) values.set(id, srmr(syntheticMaterial(id, 4).mix.channels[0], 48000));
    return values.get(id)!;
  };

  // Values computed with SRMRpy 1.0 (`srmr(x16k, 16000, fast=False)`) on the same samples.
  for (const [id, expected] of [['synthetic-dry', 3.3118], ['synthetic-room-0.8s', 3.1712], ['synthetic-room-1.5s', 2.5619]] as const) {
    it(`matches the reference implementation on ${id}`, () => {
      assert.ok(Math.abs(of(id) / expected - 1) < 0.005, `${of(id).toFixed(4)} against ${expected}`);
    });
  }

  it('falls as the same voice gets a longer room', () => {
    assert.ok(of('synthetic-dry') > of('synthetic-room-0.8s') && of('synthetic-room-0.8s') > of('synthetic-room-1.5s'));
  });

  it('also rises when a clean voice is merely gated, so a rise alone is not less reverb', () => {
    const { dry } = syntheticMaterial('synthetic-dry', 4);
    assert.ok(dry);
    const grid = powerGrid({ sampleRate: 48000, channels: [dry] });
    const { wordEnding } = describeFrames(speechInDryVoice(grid), grid.frameHz);
    // No room anywhere: the only change is that word endings are pushed down by 10 dB.
    const gated = dry.map((value, i) => (wordEnding[Math.min(grid.frames - 1, Math.floor(i / HOP))] ? 0.316 * value : value));
    assert.ok(srmr(gated, 48000) > of('synthetic-dry') * 1.03, `${srmr(gated, 48000).toFixed(3)} against ${of('synthetic-dry').toFixed(3)}`);
  });

  it('has no value for less than one 256 ms frame', () => {
    assert.ok(Number.isNaN(srmr(new Float32Array(4800), 48000)));
  });
});
