import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { syntheticMaterial } from '../synthetic';
import { noise } from '../test-utils/signals';

import { estoi } from './estoi';

describe('audio lab: ESTOI', () => {
  const dry = syntheticMaterial('synthetic-dry', 4).dry!;
  const noisy = (snrDb: number) => {
    const next = noise(9);
    const level = Math.sqrt(dry.reduce((sum, value) => sum + value * value, 0) / dry.length) * 10 ** (-snrDb / 20) * Math.sqrt(3);
    return dry.map(value => value + level * next());
  };

  it('is 1 for the reference itself, at any level', () => {
    assert.ok(Math.abs(estoi(dry, dry, 48000) - 1) < 1e-9);
    assert.ok(Math.abs(estoi(dry, dry.map(value => 0.25 * value), 48000) - 1) < 1e-9);
  });

  it('falls as noise buries the voice', () => {
    const scores = [20, 10, 0, -10].map(snr => estoi(dry, noisy(snr), 48000));
    for (let i = 1; i < scores.length; i++) assert.ok(scores[i] < scores[i - 1] - 0.03, scores.map(score => score.toFixed(3)).join(' > '));
    assert.ok(scores[0] > 0.8 && scores[3] < 0.35, scores.map(score => score.toFixed(3)).join(', '));
  });

  // Values computed with pystoi 0.4.1 (`stoi(dry, mix, 48000, extended=True)`) on the same samples.
  for (const [id, expected] of [['synthetic-room-0.8s', 0.37702], ['synthetic-room-1.5s', 0.25869]] as const) {
    it(`matches the reference implementation on ${id}`, () => {
      const { mix } = syntheticMaterial(id, 4);
      const score = estoi(dry, mix.channels[0], 48000);
      assert.ok(Math.abs(score - expected) < 5e-4, `${score.toFixed(5)} against ${expected}`);
    });
  }

  it('has no score for less than 384 ms of speech', () => {
    assert.ok(Number.isNaN(estoi(dry.subarray(0, 9600), dry.subarray(0, 9600), 48000)));
    assert.ok(Number.isNaN(estoi(new Float32Array(48000), new Float32Array(48000), 48000)));
  });
});
