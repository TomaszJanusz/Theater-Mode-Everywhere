import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ECHO_PRESETS } from '../../src/platform/echo-reduction-presets';
import { referenceEchoReduction } from '../../src/test-utils/echo-reduction-reference';

import { runEchoDsp } from './echo-dsp';
import { applyGains } from './metrics/grid';
import { syntheticMaterial } from './synthetic';
import type { Signal } from './types';

const LATENCY = 896;

function errorDb(test: Float32Array | Float64Array, reference: Float32Array | Float64Array, from: number, to: number): number {
  let error = 0;
  let signal = 0;
  for (let i = from; i < to; i++) {
    error += (test[i] - reference[i]) ** 2;
    signal += reference[i] ** 2;
  }
  return 10 * Math.log10(error / signal);
}

describe('audio lab: echo reduction offline', () => {
  const { mix } = syntheticMaterial('synthetic-room-0.8s', 1.5);

  for (const level of ['light', 'strong'] as const) {
    it(`runs the shipped binary, which matches the float64 reference at ${level}`, () => {
      const { output } = runEchoDsp(mix, ECHO_PRESETS[level]);
      const [left, right] = mix.channels.map(channel => Float64Array.from(channel));
      const [reference] = referenceEchoReduction(left, right, ECHO_PRESETS[level], mix.sampleRate);
      // The reference keeps the latency the lab removes.
      const aligned = reference.subarray(LATENCY);
      const error = errorDb(output.channels[0].subarray(0, aligned.length), aligned, 0, aligned.length);
      assert.ok(error < -90, `binary deviates from the reference by ${error.toFixed(1)} dB`);
    });

    it(`reproduces the binary's output from its captured gain at ${level}`, () => {
      const { output, gains } = runEchoDsp(mix, ECHO_PRESETS[level]);
      const rebuilt = applyGains(mix, gains);
      for (const channel of [0, 1]) {
        const error = errorDb(rebuilt.channels[channel], output.channels[channel], 0, mix.channels[0].length);
        assert.ok(error < -90, `channel ${channel}: gain applied on the lab's grid deviates by ${error.toFixed(1)} dB`);
      }
    });
  }

  it('follows the parts of a mix separately: they add up to the processed mix', () => {
    const { mix: whole, room } = syntheticMaterial('synthetic-room-0.8s', 1.5);
    assert.ok(room);
    const { output, gains } = runEchoDsp(whole, ECHO_PRESETS.strong);
    const parts: Signal[] = room.parts.map(part => applyGains(part, gains));
    const sum = new Float64Array(whole.channels[0].length);
    for (const part of parts) part.channels[0].forEach((value, i) => { sum[i] += value; });
    const error = errorDb(sum, output.channels[0], 0, sum.length);
    assert.ok(error < -80, `the followed parts deviate from the processed mix by ${error.toFixed(1)} dB`);
  });

  it('returns output of the input length with the latency removed', () => {
    const impulse: Signal = { sampleRate: 48000, channels: [new Float32Array(4000), new Float32Array(4000)] };
    impulse.channels[0][2000] = 1;
    impulse.channels[1][2000] = 1;
    const { output } = runEchoDsp(impulse, { rt60: 0.5, overSubtraction: 1, floorDb: 0, gap: 0.06 });
    assert.equal(output.channels[0].length, 4000);
    const peak = output.channels[0].reduce((best, value, i) => (Math.abs(value) > Math.abs(output.channels[0][best]) ? i : best), 0);
    assert.equal(peak, 2000);
  });
});
