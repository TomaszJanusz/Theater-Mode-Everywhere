/**
 * The speech bands: the part of the spectrum echo reduction is allowed to act on, 80 Hz to
 * 4.8 kHz (`assembly/echo-reduction.ts`). Below it lie kick drums and rumble, above it sibilance,
 * cymbals and air; the effect must leave both alone, and leave the speech bands alone too when no
 * voice has just sounded.
 *
 * Two levels of a whole signal, energy-weighted over its length: inside the speech bands and
 * outside them. The change of the level outside is what the effect does to sound it should not
 * touch at all, so it should be 0 dB. The change inside says how far the signal was turned down
 * where the effect may act; on material without a voice that, too, should be 0 dB.
 *
 * The edges are the DSP's (the same rounding to its 1024-point bins: 70 and 4805 Hz at 48 kHz),
 * but the levels are not taken on the DSP's grid. Its window lets a tone show in the bins next to
 * its own and, 23 dB down, in all the others, so on that grid a voice turned down inside the bands
 * reads as a loss outside them. This analysis uses 8192-sample Blackman-Harris frames, whose side
 * lobes are 92 dB down. The same leak is real inside the DSP: a tone within one bin (47 Hz) of an
 * edge is carried partly by bins on the other side, so a 55 Hz kick loses up to 1 dB while the
 * lowest speech bin is at its floor. That shows here as a small change outside, as it should.
 */
import type { Signal } from '../types';

import { fft } from './fft';
import { dB, FRAME as DSP_FRAME } from './grid';

const FRAME = 8192;
const HOP = FRAME / 4;
const WINDOW = Float64Array.from({ length: FRAME }, (_, i) => {
  const x = 2 * Math.PI * i / FRAME;
  return 0.35875 - 0.48829 * Math.cos(x) + 0.14128 * Math.cos(2 * x) - 0.01168 * Math.cos(3 * x);
});
const WINDOW_ENERGY = WINDOW.reduce((sum, value) => sum + value * value, 0);

/** The DSP's speech bands in Hz: the lower edge of its first bin and the upper edge of its last. */
export function speechBandEdges(sampleRate: number): { low: number; high: number } {
  const binHz = sampleRate / DSP_FRAME;
  const edge = (hz: number) => (Math.min(DSP_FRAME / 2 + 1, Math.ceil(hz / binHz)) - 0.5) * binHz;
  return { low: edge(80), high: edge(4800) };
}

/** Adds the power of one windowed frame of `data` to `sums`: [inside, outside] the bins `from` to `to`. */
function addFrame(data: Float32Array, start: number, [from, to]: [number, number], sums: [number, number]): void {
  const re = Float64Array.from(WINDOW, (weight, i) => (start + i < data.length ? data[start + i] * weight : 0));
  const im = new Float64Array(FRAME);
  fft(re, im);
  for (let k = 1; k < FRAME / 2; k++) sums[k >= from && k < to ? 0 : 1] += re[k] * re[k] + im[k] * im[k];
}

/** Mean-square level in dBFS of what `signal` holds inside and outside the speech bands, channels averaged. */
export function speechBandLevels(signal: Signal): { inside: number; outside: number } {
  const { low, high } = speechBandEdges(signal.sampleRate);
  const binHz = signal.sampleRate / FRAME;
  const bins: [number, number] = [Math.ceil(low / binHz), Math.ceil(high / binHz)];
  const sums: [number, number] = [0, 0];
  let frames = 0;
  for (const data of signal.channels) {
    // A signal shorter than a frame still gets one, padded with silence.
    for (let start = 0; start === 0 || start + FRAME <= data.length; start += HOP) {
      addFrame(data, start, bins, sums);
      frames++;
    }
  }
  // Bins 1 to N/2 - 1 each stand for two of the transform's bins.
  const scale = 2 / (FRAME * WINDOW_ENERGY * frames);
  return { inside: dB(scale * sums[0]), outside: dB(scale * sums[1]) };
}
