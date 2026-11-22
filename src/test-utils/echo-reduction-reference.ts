/**
 * A float64 model of `assembly/echo-reduction.ts`, written for clarity rather than speed: each
 * channel has its own real spectrum (no shared complex transform), the transform is a recursive
 * FFT and the stream is framed from whole arrays. The DSP test compares the WASM against it.
 */
import type { EchoPreset } from '../platform/echo-reduction-presets';

const N = 1024;
const HOP = 256;
const QUANTUM = 128;
const HISTORY = 32;
const EPSILON = 1e-20;
const ALPHA = 0.9;
const SMOOTHING_SECONDS = 0.03;

type Complex = { re: number[]; im: number[] };

function fft(re: number[], im: number[], inverse: boolean): Complex {
  const n = re.length;
  if (n === 1) return { re: [re[0]], im: [im[0]] };
  const even = fft(re.filter((_, i) => i % 2 === 0), im.filter((_, i) => i % 2 === 0), inverse);
  const odd = fft(re.filter((_, i) => i % 2 === 1), im.filter((_, i) => i % 2 === 1), inverse);
  const out: Complex = { re: new Array<number>(n), im: new Array<number>(n) };
  for (let k = 0; k < n / 2; k++) {
    const angle = (inverse ? 2 : -2) * Math.PI * k / n;
    const tr = Math.cos(angle) * odd.re[k] - Math.sin(angle) * odd.im[k];
    const ti = Math.cos(angle) * odd.im[k] + Math.sin(angle) * odd.re[k];
    out.re[k] = even.re[k] + tr;
    out.im[k] = even.im[k] + ti;
    out.re[k + n / 2] = even.re[k] - tr;
    out.im[k + n / 2] = even.im[k] - ti;
  }
  return out;
}

/** Processes whole channels; the output carries the same 896-sample latency as the worklet. */
export function referenceEchoReduction(left: Float64Array, right: Float64Array, preset: EchoPreset, rate: number): [Float64Array, Float64Array] {
  const hopSeconds = HOP / rate;
  const delayFrames = Math.max(1, Math.min(HISTORY - 1, Math.round(preset.gap / hopSeconds)));
  const decay = Math.exp(-2 * (3 * Math.LN10 / preset.rt60) * delayFrames * hopSeconds);
  const floor = 10 ** (preset.floorDb / 20);
  const smoothing = Math.exp(-hopSeconds / SMOOTHING_SECONDS);
  const window = Array.from({ length: N }, (_, i) => Math.sqrt(0.5 - 0.5 * Math.cos(2 * Math.PI * i / N)));
  const bins = N / 2 + 1;
  const smoothed = new Float64Array(bins);
  const direct = new Float64Array(bins);
  const history: Float64Array[] = [];
  const outputs = [new Float64Array(left.length), new Float64Array(left.length)];

  // The stream enters the newest quarter of the frame, so the first frame ends after one hop.
  const padded = [left, right].map(channel => {
    const data = new Float64Array(N - HOP + channel.length);
    data.set(channel, N - HOP);
    return data;
  });
  for (let start = 0; start + N <= padded[0].length; start += HOP) {
    const spectra = padded.map(data => fft(Array.from({ length: N }, (_, i) => data[start + i] * window[i]), new Array<number>(N).fill(0), false));
    const raw = new Float64Array(bins);
    for (let k = 0; k < bins; k++) {
      const p = spectra.reduce((sum, s) => sum + s.re[k] ** 2 + s.im[k] ** 2, 0) + EPSILON;
      smoothed[k] = smoothing * smoothed[k] + (1 - smoothing) * p;
      const past = history.length >= delayFrames ? history[history.length - delayFrames][k] : 0;
      const late = decay * preset.overSubtraction * past + EPSILON;
      const posterior = p / late;
      const prior = ALPHA * direct[k] / late + (1 - ALPHA) * Math.max(posterior - 1, 0);
      const g = Math.max(prior / (prior + 1), floor);
      direct[k] = g * g * p;
      raw[k] = g;
    }
    // [1 2 1] / 4 across frequency; the spectrum's symmetry supplies the neighbour beyond each edge.
    const gains = raw.map((g, k) => 0.5 * g + 0.25 * (raw[Math.abs(k - 1)] + raw[k + 1 < bins ? k + 1 : k - 1]));
    history.push(Float64Array.from(smoothed));
    for (const [channel, s] of spectra.entries()) {
      const re = s.re.map((value, k) => value * gains[Math.min(k, N - k)]);
      const im = s.im.map((value, k) => value * gains[Math.min(k, N - k)]);
      const time = fft(re, im, true);
      // Frame `start` covers stream samples start - 768 ... start + 255; its first hop is final
      // after this frame and leaves 128 samples later, at the next quantum boundary.
      for (let i = 0; i < N; i++) {
        const at = start + i + QUANTUM;
        if (at < outputs[channel].length) outputs[channel][at] += time.re[i] * window[i] * 0.5 / N;
      }
    }
  }
  return [outputs[0], outputs[1]];
}
