import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { noise, RATE, stereo } from '../test-utils/signals';

import { powerGrid } from './grid';
import { largestDip, largestDipOf } from './largest-dip';

describe('audio lab: largest dip', () => {
  const next = noise(8);
  const steady = Float32Array.from({ length: 4 * RATE }, () => 0.2 * next());
  const before = powerGrid(stereo(steady));
  /** `steady` turned down by `dB` between `from` and `to` seconds. */
  const dipped = (dB: number, from: number, to: number) => powerGrid(stereo(steady.map((value, i) => (i >= from * RATE && i < to * RATE ? value * 10 ** (-dB / 20) : value))));

  it('is 0 dB when nothing changed', () => {
    assert.equal(largestDip(before, before), 0);
  });

  it('finds a dip of a fifth of a second that the level of the whole clip hides', () => {
    const after = dipped(10, 2, 2.2);
    const whole = (grid: typeof before) => 10 * Math.log10(grid.power.reduce((sum, value) => sum + value, 0));
    assert.ok(whole(before) - whole(after) < 0.25, 'the clip as a whole lost a fifth of a decibel');
    assert.ok(Math.abs(largestDip(before, after) - 10) < 0.3, `${largestDip(before, after).toFixed(2)} dB`);
  });

  it('reads a dip shorter than its 50 ms as less deep, and ignores gain', () => {
    const short = largestDip(before, dipped(10, 2, 2.02));
    assert.ok(short > 1 && short < 6, `${short.toFixed(2)} dB`);
    assert.equal(largestDip(before, dipped(-6, 1, 3)), 0, 'louder is no dip');
  });

  it('reads a film as it reads a clip', () => {
    // Half an hour of frames: one argument per window would overflow the call stack.
    const frames = 30 * 60 * RATE / 256;
    const steadyPower = new Float64Array(frames).fill(0.01);
    assert.equal(largestDipOf(steadyPower, steadyPower), 0);
    const dippedPower = steadyPower.slice();
    dippedPower.fill(0.001, frames - 5000, frames - 4950);
    assert.ok(Math.abs(largestDipOf(steadyPower, dippedPower) - 10) < 1e-6);
  });

  it('counts only frames inside the mask, and only where there was sound', () => {
    const after = dipped(10, 2, 2.2);
    const mask = new Uint8Array(before.frames).fill(1);
    mask.fill(0, Math.floor(1.9 * RATE / 256), Math.ceil(2.3 * RATE / 256));
    assert.equal(largestDip(before, after, mask), 0);
    assert.ok(Number.isNaN(largestDip(before, after, new Uint8Array(before.frames))), 'no frames, no value');
    // Noise 60 dB under the rest of the clip is not sounding: taking it away is no dip.
    const quiet = steady.map((value, i) => (i < 2 * RATE ? value : 0.001 * value));
    assert.equal(largestDip(powerGrid(stereo(quiet)), powerGrid(stereo(quiet.map((value, i) => (i < 2.1 * RATE ? value : 0))))), 0);
  });
});
