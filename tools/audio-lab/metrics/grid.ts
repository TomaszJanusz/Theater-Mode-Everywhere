/**
 * The echo-reduction DSP's own time-frequency grid: 1024-sample frames 256 apart under a
 * square-root Hann window (`assembly/echo-reduction.ts`). Metrics are taken on this grid so that a
 * frame or a bin here is a frame or a bin the effect decided about, and so that a gain captured
 * from the effect can be applied to another signal exactly (`applyGains`).
 *
 * A grid is laid over a signal that is aligned with the effect's input: frame `m` covers samples
 * `(m + 1) * HOP - FRAME` up to `(m + 1) * HOP`, the stream entering the newest quarter first.
 */
import type { Signal } from '../types';

import { fft } from './fft';

export const FRAME = 1024;
export const HOP = 256;
export const BINS = FRAME / 2 + 1;
const WINDOW = Float64Array.from({ length: FRAME }, (_, i) => Math.sqrt(0.5 - 0.5 * Math.cos(2 * Math.PI * i / FRAME)));

/**
 * Power per frame and bin (row-major, `frames` x `BINS`), averaged over channels and scaled so that
 * a frame's power summed over all bins is its mean square: levels read in dB re full scale.
 */
export type Grid = { frames: number; power: Float64Array; binHz: number; frameHz: number };

export const frameCount = (samples: number): number => Math.floor(samples / HOP);

/** Windows frame `m` of one channel into `re`/`im` and transforms it. */
function transformFrame(data: Float32Array, m: number, re: Float64Array, im: Float64Array): void {
  const start = (m + 1) * HOP - FRAME;
  for (let i = 0; i < FRAME; i++) {
    const at = start + i;
    re[i] = at >= 0 && at < data.length ? data[at] * WINDOW[i] : 0;
    im[i] = 0;
  }
  fft(re, im);
}

// The window halves the power and bins 1 to 511 each stand for two of the transform's bins.
const powerScale = (channels: number): number => 4 / (FRAME * FRAME * channels);
const emptyGrid = (frames: number, sampleRate: number): Grid => ({ frames, power: new Float64Array(frames * BINS), binHz: sampleRate / FRAME, frameHz: sampleRate / HOP });

export function powerGrid(signal: Signal): Grid {
  const grid = emptyGrid(frameCount(signal.channels[0].length), signal.sampleRate);
  const scale = powerScale(signal.channels.length);
  const re = new Float64Array(FRAME);
  const im = new Float64Array(FRAME);
  for (const data of signal.channels) {
    for (let m = 0; m < grid.frames; m++) {
      transformFrame(data, m, re, im);
      const row = m * BINS;
      for (let k = 0; k < BINS; k++) grid.power[row + k] += scale * (re[k] * re[k] + im[k] * im[k]);
    }
  }
  return grid;
}

type Spectrum = { re: Float64Array; im: Float64Array };
const spectrum = (size: number): Spectrum => ({ re: new Float64Array(size), im: new Float64Array(size) });
const SCRATCH = spectrum(FRAME);
const SILENCE = spectrum(BINS);

/** Fills `sums[i]` with the spectrum of frame `m` of parts 0 to `i` together, for one channel of each part. */
function runningSums(parts: Float32Array[], m: number, sums: Spectrum[]): void {
  const frame = SCRATCH;
  let before = SILENCE;
  for (const [index, data] of parts.entries()) {
    transformFrame(data, m, frame.re, frame.im);
    const sum = sums[index];
    for (let k = 0; k < BINS; k++) {
      sum.re[k] = before.re[k] + frame.re[k];
      sum.im[k] = before.im[k] + frame.im[k];
    }
    before = sum;
  }
}

/** Adds to one row of two grids the power of a running sum and of what the whole has beyond it. */
function addCut(cut: { head: Grid; rest: Grid }, row: number, sum: Spectrum, whole: Spectrum): void {
  for (let k = 0; k < BINS; k++) {
    cut.head.power[row + k] += sum.re[k] * sum.re[k] + sum.im[k] * sum.im[k];
    cut.rest.power[row + k] += (whole.re[k] - sum.re[k]) ** 2 + (whole.im[k] - sum.im[k]) ** 2;
  }
}

/**
 * For consecutive parts of one signal, the grids of every way to cut it in two: `head[i]` is the
 * power of parts 0 to `i` together and `rest[i]` that of the parts after `i`. Spectra add, so each
 * part is transformed once however many cuts there are.
 */
export function splitGrids(parts: Signal[]): { head: Grid[]; rest: Grid[] } {
  const { sampleRate, channels } = parts[0];
  const frames = frameCount(channels[0].length);
  const cuts = Array.from({ length: parts.length - 1 }, () => ({ head: emptyGrid(frames, sampleRate), rest: emptyGrid(frames, sampleRate) }));
  const sums = parts.map(() => spectrum(BINS));
  for (let channel = 0; channel < channels.length; channel++) {
    const data = parts.map(part => part.channels[channel]);
    for (let m = 0; m < frames; m++) {
      runningSums(data, m, sums);
      for (const [index, cut] of cuts.entries()) addCut(cut, m * BINS, sums[index], sums[cuts.length]);
    }
  }
  const scale = powerScale(channels.length);
  for (const grid of cuts.flatMap(cut => [cut.head, cut.rest])) {
    for (let i = 0; i < grid.power.length; i++) grid.power[i] *= scale;
  }
  return { head: cuts.map(cut => cut.head), rest: cuts.map(cut => cut.rest) };
}

/**
 * Applies one gain per frame and bin (`gains[m][k]`, the same for every channel) and overlap-adds
 * the result, as the DSP does, without its latency. The effect is linear in its input once its
 * gain is known, so the gain it computed on a mix can be applied to each part of that mix: this is
 * how the lab follows the voice and the reverb through the effect separately.
 */
export function applyGains(signal: Signal, gains: Float32Array[]): Signal {
  const length = signal.channels[0].length;
  const re = new Float64Array(FRAME);
  const im = new Float64Array(FRAME);
  const channels = signal.channels.map(data => {
    const sum = new Float64Array(length);
    for (const [m, gain] of gains.entries()) {
      transformFrame(data, m, re, im);
      for (let k = 0; k < FRAME; k++) {
        const g = gain[Math.min(k, FRAME - k)];
        re[k] *= g;
        im[k] *= g;
      }
      fft(re, im, true);
      const start = (m + 1) * HOP - FRAME;
      // Square-root Hann twice is Hann, which adds up to 2 at four frames per window.
      for (let i = Math.max(0, -start); i < FRAME && start + i < length; i++) sum[start + i] += 0.5 * re[i] * WINDOW[i];
    }
    return Float32Array.from(sum);
  });
  return { sampleRate: signal.sampleRate, channels };
}

/** Bins whose centre lies in `[lowHz, highHz)`, as a half-open bin range. */
export function binRange(grid: Grid, lowHz: number, highHz: number): [number, number] {
  return [Math.min(BINS, Math.ceil(lowHz / grid.binHz)), Math.min(BINS, Math.ceil(highHz / grid.binHz))];
}

/** The band in which speech is measured: 80 Hz to 12 kHz, wide enough for sibilance. */
export const voiceBand = (grid: Grid): [number, number] => binRange(grid, 80, 12000);

/** Power of each frame summed over a bin range. */
export function framePower(grid: Grid, [from, to]: [number, number]): Float64Array {
  const out = new Float64Array(grid.frames);
  for (let m = 0; m < grid.frames; m++) {
    let sum = 0;
    for (let k = m * BINS + from; k < m * BINS + to; k++) sum += grid.power[k];
    out[m] = sum;
  }
  return out;
}

export const dB = (power: number): number => 10 * Math.log10(Math.max(power, 1e-30));

/**
 * Level in dB of the frames selected by `mask`, energy-weighted (the sum of their power), so loud
 * frames count for what they contribute. NaN when no frame is selected.
 */
export function maskedLevel(perFrame: Float64Array, mask: Uint8Array): number {
  let sum = 0;
  let count = 0;
  for (let m = 0; m < perFrame.length; m++) {
    if (!mask[m]) continue;
    sum += perFrame[m];
    count++;
  }
  return count === 0 ? Number.NaN : dB(sum / count);
}
