import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { RATE, tone } from '../test-utils/signals';

import { kWeighting, loudness } from './loudness';

describe('audio lab: loudness (BS.1770)', () => {
  it('derives the standard\'s 48 kHz filter coefficients', () => {
    const [shelf, highPass] = kWeighting(48000);
    const close = (actual: number[], expected: number[]) => actual.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < 1e-9, `${value} against ${expected[i]}`));
    close(shelf.b, [1.53512485958697, -2.69169618940638, 1.19839281085285]);
    close(shelf.a, [-1.69065929318241, 0.73248077421585]);
    close(highPass.b, [1, -2, 1]);
    close(highPass.a, [-1.99004745483398, 0.99007225036621]);
  });

  it('reads a full-scale 997 Hz sine in one channel as -3.01 LUFS', () => {
    const value = loudness({ sampleRate: RATE, channels: [tone(997, 3), new Float32Array(3 * RATE)] });
    assert.ok(Math.abs(value - -3.01) < 0.02, `${value.toFixed(3)} LUFS`);
    const other = loudness({ sampleRate: 44100, channels: [tone(997, 3, 1, 44100), new Float32Array(3 * 44100)] });
    assert.ok(Math.abs(other - -3.01) < 0.02, `${other.toFixed(3)} LUFS at 44.1 kHz`);
  });

  it('follows level and ignores the silence around a programme', () => {
    const quiet = tone(997, 3, 0.1);
    const reference = loudness({ sampleRate: RATE, channels: [quiet, quiet] });
    assert.ok(Math.abs(reference - -20) < 0.02, `${reference.toFixed(3)} LUFS`);
    const padded = new Float32Array(9 * RATE);
    padded.set(quiet, 3 * RATE);
    const gated = loudness({ sampleRate: RATE, channels: [padded, padded] });
    // Without the gate six silent seconds would cost 4.8 LU; the blocks straddling the edges cost a little.
    assert.ok(Math.abs(gated - reference) < 0.5, `${gated.toFixed(3)} LUFS with silence around it`);
    assert.ok(Number.isNaN(loudness({ sampleRate: RATE, channels: [new Float32Array(RATE)] })));
  });
});
