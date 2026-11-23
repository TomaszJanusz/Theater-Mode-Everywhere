import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { noise, RATE, stereo, tone } from '../test-utils/signals';

import { convolveAll, fft } from './fft';
import { applyGains, BINS, binRange, dB, frameCount, framePower, HOP, maskedLevel, powerGrid, splitGrids } from './grid';

describe('audio lab: transform and grid', () => {
  it('transforms like a direct Fourier sum and inverts exactly', () => {
    const next = noise(4);
    const x = Float64Array.from({ length: 64 }, next);
    const re = Float64Array.from(x);
    const im = new Float64Array(64);
    fft(re, im);
    for (const k of [0, 1, 7, 31, 63]) {
      let sumRe = 0;
      let sumIm = 0;
      for (let n = 0; n < 64; n++) {
        sumRe += x[n] * Math.cos(2 * Math.PI * k * n / 64);
        sumIm -= x[n] * Math.sin(2 * Math.PI * k * n / 64);
      }
      assert.ok(Math.abs(re[k] - sumRe) < 1e-9 && Math.abs(im[k] - sumIm) < 1e-9, `bin ${k}`);
    }
    fft(re, im, true);
    assert.ok(x.every((value, i) => Math.abs(re[i] - value) < 1e-12 && Math.abs(im[i]) < 1e-12));
    assert.throws(() => fft(new Float64Array(12), new Float64Array(12)), /power of two/);
  });

  it('convolves one signal with several kernels', () => {
    const next = noise(5);
    const x = Float64Array.from({ length: 300 }, next);
    const kernels = [Float64Array.of(1), Float64Array.of(0, 0, 0.5), Float64Array.from({ length: 40 }, next)];
    const results = convolveAll(x, kernels);
    assert.equal(results.length, 3);
    for (const [index, kernel] of kernels.entries()) {
      for (const at of [0, 1, 50, 299]) {
        let expected = 0;
        for (let j = 0; j < kernel.length && j <= at; j++) expected += kernel[j] * x[at - j];
        assert.ok(Math.abs(results[index][at] - expected) < 1e-9, `kernel ${index} at ${at}`);
      }
    }
  });

  it('reads a full-scale sine as -3 dB re full scale, in the bin it belongs to', () => {
    const grid = powerGrid(stereo(tone(1500, 1)));
    assert.equal(grid.frames, frameCount(RATE));
    assert.equal(grid.frames, RATE / HOP - 0.5);
    const steady = Uint8Array.from({ length: grid.frames }, (_, m) => (m > 8 && m < grid.frames - 8 ? 1 : 0));
    const all = maskedLevel(framePower(grid, [0, BINS]), steady);
    assert.ok(Math.abs(all - -3.01) < 0.05, `whole spectrum ${all.toFixed(2)} dB`);
    const band = maskedLevel(framePower(grid, binRange(grid, 1400, 1600)), steady);
    assert.ok(Math.abs(band - all) < 0.05, 'the tone sits in the bins around 1500 Hz');
    const elsewhere = maskedLevel(framePower(grid, binRange(grid, 3000, 12000)), steady);
    // The square-root Hann window's skirts fall slowly; 60 dB down an octave away is what it gives.
    assert.ok(elsewhere < -60, `and nowhere else (${elsewhere.toFixed(0)} dB)`);
    assert.ok(Number.isNaN(maskedLevel(framePower(grid, [0, BINS]), new Uint8Array(grid.frames))), 'no frames, no level');
  });

  it('applies a gain per frame: unity returns the signal, half lowers it by 6 dB', () => {
    const next = noise(6);
    const signal = stereo(Float32Array.from({ length: RATE / 2 }, () => 0.4 * next()));
    const frames = frameCount(signal.channels[0].length) + 4;
    const unity = applyGains(signal, Array.from({ length: frames }, () => new Float32Array(BINS).fill(1)));
    const worst = signal.channels[0].reduce((max, value, i) => Math.max(max, Math.abs(unity.channels[0][i] - value)), 0);
    assert.ok(worst < 1e-6, `perfect reconstruction (worst error ${worst})`);
    const half = applyGains(signal, Array.from({ length: frames }, () => new Float32Array(BINS).fill(0.5)));
    const change = dB(half.channels[1].reduce((sum, value) => sum + value * value, 0)) - dB(signal.channels[1].reduce((sum, value) => sum + value * value, 0));
    assert.ok(Math.abs(change - -6.02) < 0.01, `${change.toFixed(2)} dB`);
  });

  it('cuts consecutive parts in two at every boundary without transforming their sums', () => {
    const parts = [7, 8, 9].map(seed => {
      const next = noise(seed);
      return stereo(Float32Array.from({ length: 6000 }, () => 0.2 * next()));
    });
    const { head, rest } = splitGrids(parts);
    assert.equal(head.length, 2);
    const add = (signals: typeof parts) => stereo(signals[0].channels[0].map((_, i) => signals.reduce((sum, signal) => sum + signal.channels[0][i], 0)));
    for (const cut of [0, 1]) {
      const expected = [powerGrid(add(parts.slice(0, cut + 1))), powerGrid(add(parts.slice(cut + 1)))];
      for (const [grid, reference] of [[head[cut], expected[0]], [rest[cut], expected[1]]] as const) {
        const worst = reference.power.reduce((max, value, i) => Math.max(max, Math.abs(grid.power[i] - value)), 0);
        const largest = reference.power.reduce((max, value) => Math.max(max, value), 0);
        assert.ok(worst < 1e-6 * largest, `cut ${cut}`);
      }
    }
  });
});
