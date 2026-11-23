/**
 * ESTOI (extended short-time objective intelligibility; Jensen and Taal, 2016): how well the
 * 384 ms patterns of a test signal's third-octave envelopes follow those of a reference, 0 to 1.
 * It predicts intelligibility, and it is the fairest judge of an echo reducer: it rewards a
 * clearer envelope and punishes a voice that is gated away with the reverb.
 *
 * The score depends on the reference as much as on the test signal. Against the direct sound it
 * counts every reflection as damage; against the first 50 ms it forgives the reflections a
 * reducer is meant to remove. The lab therefore reports it at each reference point.
 *
 * A port of the reference algorithm as implemented in pystoi 0.4.1 (10 kHz, 256-sample frames,
 * 15 third-octave bands from 150 Hz, silent frames of the reference removed), without the
 * dithering noise that implementation adds, so the score is deterministic.
 */
import { fft } from './fft';
import { octaveFilter, resample } from './resample';

const RATE = 10000;
const FRAME = 256;
const HOP = FRAME / 2;
const FFT_SIZE = 512;
const BANDS = 15;
const LOWEST_CENTRE = 150;
const SEGMENT = 30;
const DYNAMIC_RANGE = 40;
const WINDOW = Float64Array.from({ length: FRAME }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * (i + 1) / (FRAME + 1)));

/** First and one-past-last FFT bin of each third-octave band. */
const BAND_BINS = Array.from({ length: BANDS }, (_, band) => {
  const nearest = (hz: number) => Math.round(hz * FFT_SIZE / RATE);
  return [nearest(LOWEST_CENTRE * 2 ** ((2 * band - 1) / 6)), nearest(LOWEST_CENTRE * 2 ** ((2 * band + 1) / 6))] as const;
});

const frameStarts = (length: number): number[] => {
  const starts: number[] = [];
  for (let start = 0; start < length - FRAME; start += HOP) starts.push(start);
  return starts;
};

/** Drops the frames in which the reference is more than 40 dB below its loudest frame, from both signals. */
function removeSilence(reference: Float64Array, test: Float64Array): [Float64Array, Float64Array] {
  const starts = frameStarts(reference.length);
  const energies = starts.map(start => {
    let sum = 0;
    for (let i = 0; i < FRAME; i++) sum += (WINDOW[i] * reference[start + i]) ** 2;
    return 20 * Math.log10(Math.sqrt(sum) + Number.EPSILON);
  });
  const loudest = energies.reduce((max, energy) => Math.max(max, energy), Number.NEGATIVE_INFINITY);
  // A reference with no sound in it has no speech frames, whatever its (equal) frame energies say.
  const silent = loudest <= 20 * Math.log10(Number.EPSILON);
  const kept = silent ? [] : starts.filter((_, index) => energies[index] > loudest - DYNAMIC_RANGE);
  const length = kept.length === 0 ? 0 : (kept.length - 1) * HOP + FRAME;
  const out: [Float64Array, Float64Array] = [new Float64Array(length), new Float64Array(length)];
  for (const [index, start] of kept.entries()) {
    for (let i = 0; i < FRAME; i++) {
      out[0][index * HOP + i] += WINDOW[i] * reference[start + i];
      out[1][index * HOP + i] += WINDOW[i] * test[start + i];
    }
  }
  return out;
}

/** Third-octave band magnitudes per frame: `bands[band][frame]`. */
function thirdOctaves(signal: Float64Array): Float64Array[] {
  const starts = frameStarts(signal.length);
  const bands = Array.from({ length: BANDS }, () => new Float64Array(starts.length));
  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);
  for (const [frame, start] of starts.entries()) {
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < FRAME; i++) re[i] = WINDOW[i] * signal[start + i];
    fft(re, im);
    for (const [band, [from, to]] of BAND_BINS.entries()) {
      let sum = 0;
      for (let k = from; k < to; k++) sum += re[k] * re[k] + im[k] * im[k];
      bands[band][frame] = Math.sqrt(sum);
    }
  }
  return bands;
}

/** A 15 x 30 segment with each band's row, then each frame's column, brought to zero mean and unit norm. */
function normalised(bands: Float64Array[], end: number): Float64Array[] {
  const rows = bands.map(band => {
    const row = band.slice(end - SEGMENT, end);
    const mean = row.reduce((sum, value) => sum + value, 0) / SEGMENT;
    const norm = Math.sqrt(row.reduce((sum, value) => sum + (value - mean) ** 2, 0));
    return row.map(value => (norm > 0 ? (value - mean) / norm : 0));
  });
  for (let column = 0; column < SEGMENT; column++) {
    const mean = rows.reduce((sum, row) => sum + row[column], 0) / BANDS;
    const norm = Math.sqrt(rows.reduce((sum, row) => sum + (row[column] - mean) ** 2, 0));
    for (const row of rows) row[column] = norm > 0 ? (row[column] - mean) / norm : 0;
  }
  return rows;
}

type Samples = Float32Array | Float64Array;

/** NaN when the reference holds less than 30 frames (384 ms) of speech. */
export function estoi(reference: Samples, test: Samples, sampleRate: number): number {
  const length = Math.min(reference.length, test.length);
  const [clean, processed] = removeSilence(
    resample(reference.subarray(0, length), sampleRate, RATE, octaveFilter),
    resample(test.subarray(0, length), sampleRate, RATE, octaveFilter)
  );
  const [cleanBands, processedBands] = [thirdOctaves(clean), thirdOctaves(processed)];
  const frames = cleanBands[0].length;
  if (frames < SEGMENT) return Number.NaN;
  let sum = 0;
  for (let end = SEGMENT; end <= frames; end++) {
    const [a, b] = [normalised(cleanBands, end), normalised(processedBands, end)];
    for (let band = 0; band < BANDS; band++) {
      for (let column = 0; column < SEGMENT; column++) sum += a[band][column] * b[band][column];
    }
  }
  return sum / SEGMENT / (frames - SEGMENT + 1);
}
