/**
 * Programme loudness (ITU-R BS.1770-4, integrated, in LUFS): the overall level as heard, with the
 * standard's K-weighting and its gating of silent and quiet passages. It tells a real change in
 * level from a change in character, and gives listening comparisons a gain to match by.
 */
import type { Signal } from '../types';

type Biquad = { b: [number, number, number]; a: [number, number] };

/** The standard's two stages, re-derived for any sample rate (its table is given for 48 kHz only). */
export function kWeighting(sampleRate: number): Biquad[] {
  const shelf = (() => {
    const k = Math.tan(Math.PI * 1681.974450955533 / sampleRate);
    const q = 0.7071752369554196;
    const high = 10 ** (3.999843853973347 / 20);
    const band = high ** 0.4996667741545416;
    const norm = 1 + k / q + k * k;
    return { b: [(high + band * k / q + k * k) / norm, 2 * (k * k - high) / norm, (high - band * k / q + k * k) / norm], a: [2 * (k * k - 1) / norm, (1 - k / q + k * k) / norm] } satisfies Biquad;
  })();
  const highPass = (() => {
    const k = Math.tan(Math.PI * 38.13547087602444 / sampleRate);
    const q = 0.5003270373238773;
    const norm = 1 + k / q + k * k;
    return { b: [1, -2, 1], a: [2 * (k * k - 1) / norm, (1 - k / q + k * k) / norm] } satisfies Biquad;
  })();
  return [shelf, highPass];
}

function weighted(channel: Float32Array, stages: Biquad[]): Float64Array {
  let x = Float64Array.from(channel);
  for (const { b, a } of stages) {
    const y = new Float64Array(x.length);
    let [x1, x2, y1, y2] = [0, 0, 0, 0];
    for (let i = 0; i < x.length; i++) {
      const out = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2;
      x2 = x1; x1 = x[i]; y2 = y1; y1 = out;
      y[i] = out;
    }
    x = y;
  }
  return x;
}

const lufs = (power: number): number => -0.691 + 10 * Math.log10(power);

/** Front channels only (weight 1 each). NaN when nothing passes the -70 LUFS gate or the signal is under 400 ms. */
export function loudness(signal: Signal): number {
  const stages = kWeighting(signal.sampleRate);
  const channels = signal.channels.map(channel => weighted(channel, stages));
  const block = Math.round(0.4 * signal.sampleRate);
  const step = Math.round(0.1 * signal.sampleRate);
  const powers: number[] = [];
  for (let start = 0; start + block <= channels[0].length; start += step) {
    let sum = 0;
    for (const channel of channels) {
      for (let i = start; i < start + block; i++) sum += channel[i] * channel[i];
    }
    powers.push(sum / block);
  }
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const audible = powers.filter(power => lufs(power) > -70);
  if (audible.length === 0) return Number.NaN;
  const relative = lufs(mean(audible)) - 10;
  return lufs(mean(audible.filter(power => lufs(power) > relative)));
}
