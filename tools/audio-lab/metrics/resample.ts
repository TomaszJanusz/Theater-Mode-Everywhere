/**
 * Rational sample-rate conversion by a windowed-sinc polyphase filter, laid out like scipy's
 * `resample_poly` so the ported intelligibility metrics see the samples their reference
 * implementations see: output sample `j` is the filtered, `up`-times zero-stuffed input at `j * down`.
 */
const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** Zeroth-order modified Bessel function of the first kind, by its power series. */
function besselI0(x: number): number {
  let sum = 1;
  let term = 1;
  for (let k = 1; k < 60; k++) {
    term *= (x / (2 * k)) ** 2;
    sum += term;
    if (term < 1e-17 * sum) break;
  }
  return sum;
}

function kaiser(length: number, beta: number): Float64Array {
  return Float64Array.from({ length }, (_, n) => {
    const r = 2 * n / (length - 1) - 1;
    return besselI0(beta * Math.sqrt(Math.max(0, 1 - r * r))) / besselI0(beta);
  });
}

const sinc = (x: number): number => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));

/** A unity-gain low-pass of `2 * half + 1` taps with its cutoff at `cutoff` (1 is Nyquist). */
function lowpass(half: number, cutoff: number, beta: number): Float64Array {
  const window = kaiser(2 * half + 1, beta);
  const taps = window.map((w, n) => w * cutoff * sinc(cutoff * (n - half)));
  const sum = taps.reduce((total, tap) => total + tap, 0);
  return taps.map(tap => tap / sum);
}

/** scipy's default anti-aliasing filter: ten periods of the slower rate each side, Kaiser beta 5. */
function defaultFilter(up: number, down: number): Float64Array {
  const rate = Math.max(up, down);
  return lowpass(10 * rate, 1 / rate, 5);
}

/**
 * The filter of Octave's `resample`, which the STOI reference code uses (60 dB rejection, roll-off
 * a tenth of the stopband edge). Kept apart so ESTOI stays comparable with published scores.
 * Ported from pystoi (MIT; see `THIRD-PARTY-LICENSES.md`).
 */
export function octaveFilter(up: number, down: number): Float64Array {
  const rejectionDb = 60;
  const stopband = 1 / (2 * Math.max(up, down));
  const half = Math.ceil((rejectionDb - 8) / (28.714 * stopband / 10));
  return lowpass(half, 2 * stopband, 0.1102 * (rejectionDb - 8.7));
}

type FilterDesign = (up: number, down: number) => Float64Array;

export function resample(x: Float32Array | Float64Array, fromRate: number, toRate: number, design: FilterDesign = defaultFilter): Float64Array {
  if (fromRate === toRate) return Float64Array.from(x);
  const divisor = gcd(toRate, fromRate);
  const up = toRate / divisor;
  const down = fromRate / divisor;
  const taps = design(up, down);
  const half = (taps.length - 1) / 2;
  const out = new Float64Array(Math.ceil(x.length * up / down));
  for (let j = 0; j < out.length; j++) {
    const centre = j * down + half;
    const first = Math.max(0, Math.ceil((centre - taps.length + 1) / up));
    const last = Math.min(x.length - 1, Math.floor(centre / up));
    let sum = 0;
    for (let i = first; i <= last; i++) sum += x[i] * taps[centre - i * up];
    out[j] = up * sum;
  }
  return out;
}
