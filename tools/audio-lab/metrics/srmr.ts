/**
 * SRMR (speech-to-reverberation modulation energy ratio; Falk, Zheng and Chan, 2010): of the
 * energy in a signal's envelope modulations, the share at speech rates (4 to about 18 Hz) over the
 * share at faster rates, where reverberant tails put theirs. It needs no reference, so it is the
 * one reverb measure that works on a real clip.
 *
 * What it cannot tell: it rises for anything that deepens the gaps between sounds. Echo reduction
 * raised it on clean studio speech with no reverb to remove (6.5 to 7.8 and 8.4 in TME-279),
 * simply by gating the voice. Read a rise as "the envelope is more modulated", never as "less
 * reverb" on its own; the tail and voice metrics say which of the two happened. Values compare
 * only between versions of the same clip.
 *
 * A port of the time-domain variant of SRMRpy 1.0 (`fast=False, norm=False`): 16 kHz, 23
 * gammatone channels from 125 Hz, Hilbert envelopes, eight modulation bands from 4 to 128 Hz
 * (Q = 2), 256 ms frames 64 ms apart. Earlier pages used SRMRpy's faster gammatonegram
 * approximation, whose numbers differ from these.
 */
import { fft, nextPowerOfTwo } from './fft';
import { resample } from './resample';

const RATE = 16000;
const CHANNELS = 23;
const LOWEST = 125;
const MODULATION_BANDS = 8;
const MODULATION_Q = 2;
// Glasberg and Moore's equivalent rectangular bandwidth.
const EAR_Q = 9.26449;
const MIN_BANDWIDTH = 24.7;

const erb = (hz: number): number => hz / EAR_Q + MIN_BANDWIDTH;

/** Centre frequencies evenly spaced on the ERB scale, highest first, the last one at `LOWEST`. */
const CENTRES = Array.from({ length: CHANNELS }, (_, i) => {
  const offset = EAR_Q * MIN_BANDWIDTH;
  return -offset + Math.exp((i + 1) / CHANNELS * (Math.log(LOWEST + offset) - Math.log(RATE / 2 + offset))) * (RATE / 2 + offset);
});

const MODULATION_CENTRES = Array.from({ length: MODULATION_BANDS }, (_, k) => 4 * (128 / 4) ** (k / (MODULATION_BANDS - 1)));

type Biquad = { b: [number, number, number]; a: [number, number, number] };

function filter({ b, a }: Biquad, x: Float64Array): Float64Array {
  const y = new Float64Array(x.length);
  const [b0, b1, b2, a1, a2] = [b[0] / a[0], b[1] / a[0], b[2] / a[0], a[1] / a[0], a[2] / a[0]];
  let [x1, x2, y1, y2] = [0, 0, 0, 0];
  for (let i = 0; i < x.length; i++) {
    const out = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = out;
    y[i] = out;
  }
  return y;
}

/** Slaney's gammatone filter: four second-order sections sharing their poles, and its gain at the centre. */
function gammatone(centre: number): { sections: Biquad[]; gain: number } {
  const T = 1 / RATE;
  const B = 1.019 * 2 * Math.PI * erb(centre);
  const arg = 2 * Math.PI * centre * T;
  const a: [number, number, number] = [1, -2 * Math.cos(arg) / Math.exp(B * T), Math.exp(-2 * B * T)];
  const roots = [Math.sqrt(3 + 2 ** 1.5), -Math.sqrt(3 + 2 ** 1.5), Math.sqrt(3 - 2 ** 1.5), -Math.sqrt(3 - 2 ** 1.5)];
  const ks = roots.map(root => Math.cos(arg) + root * Math.sin(arg));
  const sections = ks.map(k => ({ b: [T, -T * Math.exp(-B * T) * k, 0] as [number, number, number], a }));
  // |prod(e^{2j arg} - e^{j arg - BT} k_i)| * |T e^{BT} / (-e^{-BT} + 1 + e^{2j arg} (1 - e^{BT}))|^4
  let gain = 1;
  for (const k of ks) {
    gain *= Math.hypot(Math.cos(2 * arg) - Math.exp(-B * T) * k * Math.cos(arg), Math.sin(2 * arg) - Math.exp(-B * T) * k * Math.sin(arg));
  }
  const re = -Math.exp(-B * T) + 1 + Math.cos(2 * arg) * (1 - Math.exp(B * T));
  const im = Math.sin(2 * arg) * (1 - Math.exp(B * T));
  gain *= (T * Math.exp(B * T) / Math.hypot(re, im)) ** 4;
  return { sections, gain };
}

/** Magnitude of the analytic signal. */
function envelope(x: Float64Array): Float64Array {
  const n = nextPowerOfTwo(x.length);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  re.set(x);
  fft(re, im);
  for (let k = 1; k < n / 2; k++) { re[k] *= 2; im[k] *= 2; }
  for (let k = n / 2 + 1; k < n; k++) { re[k] = 0; im[k] = 0; }
  fft(re, im, true);
  return Float64Array.from({ length: x.length }, (_, i) => Math.hypot(re[i], im[i]));
}

function modulationFilter(centre: number): Biquad {
  const w = Math.tan(Math.PI * centre / RATE);
  const b0 = w / MODULATION_Q;
  return { b: [b0, 0, -b0], a: [1 + b0 + w * w, 2 * w * w - 2, 1 - b0 + w * w] };
}

const FRAME = Math.ceil(0.256 * RATE);
const HOP = Math.ceil(0.064 * RATE);
const HAMMING = Float64Array.from({ length: FRAME }, (_, i) => 0.54 - 0.46 * Math.cos(2 * Math.PI * i / FRAME));

/** Mean over 256 ms Hamming-windowed frames, 64 ms apart, of the frame's energy. */
function meanFrameEnergy(x: Float64Array): number {
  const frames = 1 + Math.floor((x.length - FRAME) / HOP);
  let total = 0;
  for (let frame = 0; frame < frames; frame++) {
    for (let i = 0; i < FRAME; i++) total += (HAMMING[i] * x[frame * HOP + i]) ** 2;
  }
  return total / frames;
}

/**
 * The upper modulation band counted as "reverberant" follows the signal's bandwidth: the ERB of
 * the gammatone channel below which 90 % of the energy lies, compared with the modulation
 * filters' lower cut-offs. Returns how many of the eight bands take part (5 to 8).
 */
function bandsInUse(energy: number[][]): number {
  const perChannel = energy.map(bands => bands.reduce((sum, value) => sum + value, 0));
  const total = perChannel.reduce((sum, value) => sum + value, 0);
  let cumulative = 0;
  let bandwidth = erb(CENTRES[0]);
  // Channels run from the highest centre to the lowest; accumulate from the lowest.
  for (let channel = CHANNELS - 1; channel >= 0; channel--) {
    cumulative += perChannel[channel];
    if (cumulative > 0.9 * total) { bandwidth = erb(CENTRES[channel]); break; }
  }
  const cutoffs = MODULATION_CENTRES.map(centre => centre - Math.tan(Math.PI * centre / RATE) / MODULATION_Q * RATE / (2 * Math.PI));
  let count = 5;
  for (let band = 5; band < MODULATION_BANDS; band++) if (bandwidth > cutoffs[band]) count = band + 1;
  return count;
}

/** NaN for less than one 256 ms frame of signal. */
export function srmr(signal: Float32Array | Float64Array, sampleRate: number): number {
  const x = resample(signal, sampleRate, RATE);
  if (x.length < FRAME) return Number.NaN;
  const filters = MODULATION_CENTRES.map(modulationFilter);
  const energy = CENTRES.map(centre => {
    const { sections, gain } = gammatone(centre);
    const band = sections.reduce((y, section) => filter(section, y), x);
    const hull = envelope(band.map(value => value / gain));
    return filters.map(modulation => meanFrameEnergy(filter(modulation, hull)));
  });
  const count = bandsInUse(energy);
  const sum = (from: number, to: number) => energy.reduce((total, bands) => total + bands.slice(from, to).reduce((s, value) => s + value, 0), 0);
  return sum(0, 4) / sum(4, count);
}
