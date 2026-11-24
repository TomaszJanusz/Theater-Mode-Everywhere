/**
 * A float64 model of `assembly/echo-reduction.ts`, written for clarity rather than speed: each
 * channel has its own real spectrum (no shared complex transform), the transform is a recursive
 * FFT and the stream is framed from whole arrays. The DSP test compares the WASM against it.
 */
import type { EchoPreset } from '../platform/echo-reduction-presets';

import { fft } from './echo-reduction-fft';
import { RISE_FROM, speechWindow, unit } from './echo-reduction-speech-window';

// The constants of the DSP, under the same names.
const [N, HOP, QUANTUM, HISTORY] = [1024, 256, 128, 32];
const EPSILON = 1e-20;
const ALPHA = 0.9;
const SMOOTHING_SECONDS = 0.03;
const BANDS = 5;
const [SPEECH_FROM_HZ, FIRST_EDGE_HZ] = [80, 300];
const FALL_DB_PER_SECOND = 37.5;
const RISE_DB_PER_SECOND = FALL_DB_PER_SECOND / 9;
const HEADROOM = 1.7782794;
const REMAIN_MIN = 0.0031622777;
const GATE = 1e-4;
const PEAK_FALL_DB_PER_SECOND = 0.6;
const FED_FROM = 2;
const FED_SPAN = 4;
const RELEASE_SECONDS = 0.025;
const [KEEP_FROM, KEEP_SLOPE, START_GATE] = [0.05, 20, 1e-3];
const [QUIET, HOLD_SECONDS, HOLD_SPAN_SECONDS, LOUD_FALL_DB_PER_SECOND] = [1e-2, 1.25, 0.25, 60];
const [LOW_RISE_DB_PER_SECOND, STALE_RISE_DB_PER_SECOND, STALE_FROM, STALE_SPAN] = [12, 30, 2, 2];
const [CAP_RATIO, PEAKS_SHARE] = [0.3, 0.01];

/** Processes whole channels; the output carries the same 896-sample latency as the worklet. */
export function referenceEchoReduction(left: Float64Array, right: Float64Array, preset: EchoPreset, rate: number): [Float64Array, Float64Array] {
  const hopSeconds = HOP / rate;
  const delayFrames = Math.max(1, Math.min(HISTORY - 1, Math.round(preset.gap / hopSeconds)));
  const presetShare = Math.exp(-2 * (3 * Math.LN10 / preset.rt60) * delayFrames * hopSeconds) * preset.overSubtraction;
  const floor = 10 ** (preset.floorDb / 20);
  const cap = 10 ** (CAP_RATIO * preset.floorDb / 20);
  const smoothing = Math.exp(-hopSeconds / SMOOTHING_SECONDS);
  const fall = 10 ** (-FALL_DB_PER_SECOND * hopSeconds / 10);
  const rise = 10 ** (RISE_DB_PER_SECOND * hopSeconds / 10);
  const peakFall = 10 ** (-PEAK_FALL_DB_PER_SECOND * hopSeconds / 10);
  const release = Math.exp(-hopSeconds / RELEASE_SECONDS);
  const lowRise = 10 ** (LOW_RISE_DB_PER_SECOND * hopSeconds / 10);
  const staleRise = 10 ** (STALE_RISE_DB_PER_SECOND * hopSeconds / 10);
  const loudFall = 10 ** (-LOUD_FALL_DB_PER_SECOND * hopSeconds / 10);
  const window = Array.from({ length: N }, (_, i) => Math.sqrt(0.5 - 0.5 * Math.cos(2 * Math.PI * i / N)));
  const bins = N / 2 + 1;
  // Band b covers bins bandStart[b] to bandStart[b + 1]: 80-300 Hz, then four octaves. These are the
  // speech bands; every bin outside them keeps a gain of 1.
  const bandStart = [SPEECH_FROM_HZ, ...Array.from({ length: BANDS }, (_, b) => FIRST_EDGE_HZ * 2 ** b)].map(hz => Math.min(bins, Math.ceil(hz * N / rate)));
  const [speechFrom, speechTo] = [bandStart[0], bandStart[BANDS]];
  const remain = new Float64Array(BANDS).fill(1);
  const fed = new Float64Array(BANDS);
  const peak = new Float64Array(BANDS);
  const lowest = new Float64Array(BANDS).fill(1);
  const loud = new Float64Array(BANDS);
  const quiet = new Float64Array(BANDS);
  const share = new Float64Array(bins);
  const floors = new Float64Array(bins);
  const smoothed = new Float64Array(bins);
  const direct = new Float64Array(bins);
  const speech = speechWindow(hopSeconds);
  // The sum of `loud` after the previous frame.
  let peaks = 0;
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
    const power = Float64Array.from({ length: bins }, (_, k) => spectra.reduce((sum, s) => sum + s.re[k] ** 2 + s.im[k] ** 2, 0) + EPSILON);
    const pastFrame = history.length >= delayFrames ? history[history.length - delayFrames] : null;
    // Per band: learn how much power remains after the gap when nothing feeds the band, decide how far
    // the band is fed by a source, and set the late share and the floor of its bins. The floor reaches
    // below 1 only as far as the speech window lets it.
    const tail = speech.tail();
    const heard = { parts: new Array<number>(BANDS), before: 0, totalNow: 0, totalWas: 0 };
    let recentPeaks = 0;
    for (let b = 0; b < BANDS; b++) {
      const [from, to] = [bandStart[b], bandStart[b + 1]];
      let now = 0;
      let was = EPSILON * (to - from + 1);
      for (let k = from; k < to; k++) {
        now += power[k];
        was += pastFrame ? pastFrame[k] : 0;
      }
      const ratio = now / was;
      peak[b] = Math.max(was, peak[b] * peakFall);
      const open = unit(was / (peak[b] * GATE + EPSILON) - 1);
      const evidence = ratio * HEADROOM;
      const turn = unit((evidence / remain[b] - 0.9) * 5);
      // When even the lowest evidence of the last second stands well above `remain`, it is stale and rises fast.
      lowest[b] = Math.max(REMAIN_MIN, Math.min(1, lowest[b] + open * (Math.min(evidence, lowest[b] * lowRise) - lowest[b])));
      const up = rise + (staleRise - rise) * unit((lowest[b] / remain[b] - STALE_FROM) / STALE_SPAN);
      remain[b] = Math.max(REMAIN_MIN, Math.min(1, remain[b] * (1 + open * (fall + (up - fall) * turn - 1))));
      // The level of the speech bands, now and before the gap: each band against its own recent peak.
      const weight = 1 / (loud[b] + now + PEAKS_SHARE * peaks + EPSILON);
      heard.parts[b] = now * weight;
      heard.before += was * weight;
      heard.totalNow += now;
      heard.totalWas += was;
      // `loud` is the loudest the band has lately been: it falls fast once the band has stayed 20 dB below it for 1.25 s.
      quiet[b] = Math.min(unit(2 - now / (loud[b] * QUIET + EPSILON)) * (quiet[b] + hopSeconds), HOLD_SECONDS + HOLD_SPAN_SECONDS);
      loud[b] = Math.max(was, loud[b] * (peakFall + (loudFall - peakFall) * unit((quiet[b] - HOLD_SECONDS) / HOLD_SPAN_SECONDS)));
      // A band becomes fed only while its power rises within 30 dB of that, and stays fed until it falls to the decay.
      const onset = unit(ratio - RISE_FROM) * unit(now / (loud[b] * START_GATE + EPSILON) - 1);
      const start = Math.max(onset, unit((fed[b] - KEEP_FROM) * KEEP_SLOPE));
      fed[b] = Math.max(unit((ratio / remain[b] - FED_FROM) / FED_SPAN) * start, fed[b] * release);
      recentPeaks += loud[b];
      share.fill(presetShare + (Math.min(remain[b], presetShare) - presetShare) * fed[b], from, to);
      floors.fill(1 + (floor + (cap - floor) * fed[b] - 1) * tail, from, to);
    }
    peaks = recentPeaks;
    speech.hear(heard);
    const raw = new Float64Array(bins).fill(1);
    for (let k = speechFrom; k < speechTo; k++) {
      const p = power[k];
      smoothed[k] = smoothing * smoothed[k] + (1 - smoothing) * p;
      const late = share[k] * (pastFrame ? pastFrame[k] : 0) + EPSILON;
      const posterior = p / late;
      const prior = ALPHA * direct[k] / late + (1 - ALPHA) * Math.max(posterior - 1, 0);
      const g = Math.max(1 - 1 / (prior + 1), floors[k]);
      direct[k] = g * g * p;
      raw[k] = g;
    }
    // [1 2 1] / 4 across frequency. The lowest bin of the speech bands is smoothed against itself; the
    // bin above them counts as 1, or at N/2 as its mirror image.
    raw[speechFrom - 1] = raw[speechFrom];
    const gains = raw.map((g, k) => (k < speechFrom || k >= speechTo ? 1 : 0.5 * g + 0.25 * (raw[Math.abs(k - 1)] + raw[k + 1 < bins ? k + 1 : k - 1])));
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
