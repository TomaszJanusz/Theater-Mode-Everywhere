import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { tone } from '../test-utils/signals';

import { octaveFilter, resample } from './resample';

const rms = (values: Float64Array, from: number, to: number) => Math.sqrt(values.subarray(from, to).reduce((sum, value) => sum + value * value, 0) / (to - from));

describe('audio lab: resampling', () => {
  it('keeps a tone in the passband at its level and frequency', () => {
    for (const [from, to] of [[48000, 16000], [16000, 48000], [44100, 48000], [48000, 10000]] as const) {
      const out = resample(tone(1000, 0.5, 0.5, from), from, to);
      assert.equal(out.length, Math.ceil(0.5 * from * to / from));
      const [a, b] = [Math.round(0.1 * to), Math.round(0.4 * to)];
      assert.ok(Math.abs(rms(out, a, b) - 0.5 / Math.SQRT2) < 0.002, `${from} to ${to}: level ${rms(out, a, b).toFixed(4)}`);
      let worst = 0;
      for (let i = a; i < b; i++) worst = Math.max(worst, Math.abs(out[i] - 0.5 * Math.sin(2 * Math.PI * 1000 * i / to)));
      assert.ok(worst < 0.005, `${from} to ${to}: waveform error ${worst.toFixed(4)}`);
    }
  });

  it('removes what the lower rate cannot carry instead of folding it back', () => {
    const plain = resample(tone(7000, 0.5, 0.5), 48000, 10000);
    assert.ok(rms(plain, 1000, 4000) < 0.5 * 10 ** (-40 / 20), `default filter leaves ${rms(plain, 1000, 4000).toExponential(1)}`);
    const octave = resample(tone(7000, 0.5, 0.5), 48000, 10000, octaveFilter);
    assert.ok(rms(octave, 1000, 4000) < 0.5 * 10 ** (-55 / 20), `Octave filter leaves ${rms(octave, 1000, 4000).toExponential(1)}`);
  });

  it('copies the signal when the rate does not change', () => {
    const x = tone(440, 0.01);
    assert.deepEqual(Array.from(resample(x, 48000, 48000)), Array.from(x));
  });
});
