import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { noise, RATE, stereo, tone } from '../test-utils/signals';

import { speechBandEdges, speechBandLevels } from './speech-bands';

describe('audio lab: speech bands', () => {
  it('takes its edges from the bins of the DSP at each sample rate', () => {
    // Bins 2 to 102 of 1024 points at 48 kHz, 46.875 Hz apart: 80 Hz and 4.8 kHz rounded up to whole bins.
    assert.deepEqual(speechBandEdges(48000), { low: 1.5 * 46.875, high: 102.5 * 46.875 });
    const { low, high } = speechBandEdges(44100);
    assert.equal(Math.round(low), 65);
    assert.equal(Math.round(high), 4802);
  });

  it('puts a tone inside or outside by its frequency, at its level', () => {
    for (const [hz, where] of [[1000, 'inside'], [200, 'inside'], [4500, 'inside'], [40, 'outside'], [5200, 'outside'], [12000, 'outside']] as const) {
      const levels = speechBandLevels(stereo(tone(hz, 1, 0.5)));
      const other = where === 'inside' ? 'outside' : 'inside';
      // A sine of amplitude 0.5 has a mean square of 0.125: -9.03 dBFS.
      assert.ok(Math.abs(levels[where] + 9.03) < 0.05, `${hz} Hz is ${where}: ${levels[where].toFixed(2)} dBFS`);
      assert.ok(levels[other] < -90, `${hz} Hz leaves ${other} empty: ${levels[other].toFixed(0)} dBFS`);
    }
  });

  it('shows no change outside when only the inside is turned down', () => {
    // On the DSP's own grid the side lobes of the inside tone would read as a loss outside.
    const [low, high, voice] = [tone(40, 2, 0.05), tone(9000, 2, 0.05), tone(180, 2, 0.5)];
    const mix = (gain: number) => stereo(voice.map((value, i) => gain * value + low[i] + high[i]));
    const [before, after] = [speechBandLevels(mix(1)), speechBandLevels(mix(0.5))];
    assert.ok(Math.abs(after.inside - before.inside + 6.02) < 0.01);
    assert.ok(Math.abs(after.outside - before.outside) < 0.001, `${(after.outside - before.outside).toFixed(4)} dB`);
  });

  it('adds up to the level of the whole signal', () => {
    const next = noise(4);
    const samples = Float32Array.from({ length: 3 * RATE }, () => 0.3 * next());
    const { inside, outside } = speechBandLevels(stereo(samples));
    const whole = 10 * Math.log10(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
    assert.ok(Math.abs(10 * Math.log10(10 ** (inside / 10) + 10 ** (outside / 10)) - whole) < 0.1);
  });
});
