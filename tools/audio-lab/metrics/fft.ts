/**
 * An in-place radix-2 FFT on separate real and imaginary arrays. The lab transforms a few thousand
 * 1024-point frames per clip and whole clips for convolution, so this is the fast counterpart of
 * the deliberately naive transform in `src/test-utils/echo-reduction-reference.ts`.
 */
type Table = { cos: Float64Array; sin: Float64Array; reversed: Uint32Array };
const tables = new Map<number, Table>();

/**
 * Twiddle factors laid out stage by stage: the factors of the stage that joins blocks of `half`
 * points sit at `half ... 2 * half - 1`, so every stage reads its factors in order.
 */
function table(n: number): Table {
  let entry = tables.get(n);
  if (entry) return entry;
  if (n < 2 || (n & (n - 1)) !== 0) throw new Error(`FFT length must be a power of two, got ${n}`);
  const bits = Math.log2(n);
  const reversed = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >>> b) & 1) << (bits - 1 - b);
    reversed[i] = r >>> 0;
  }
  const cos = new Float64Array(n);
  const sin = new Float64Array(n);
  for (let half = 1; half < n; half *= 2) {
    for (let k = 0; k < half; k++) {
      cos[half + k] = Math.cos(Math.PI * k / half);
      sin[half + k] = Math.sin(Math.PI * k / half);
    }
  }
  entry = { cos, sin, reversed };
  tables.set(n, entry);
  return entry;
}

/** Forward transform, or the inverse scaled by 1/n. */
export function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  const { cos, sin, reversed } = table(n);
  for (let i = 0; i < n; i++) {
    const j = reversed[i];
    if (j > i) {
      const r = re[i]; re[i] = re[j]; re[j] = r;
      const s = im[i]; im[i] = im[j]; im[j] = s;
    }
  }
  const sign = inverse ? 1 : -1;
  for (let half = 1; half < n; half *= 2) {
    for (let start = 0; start < n; start += 2 * half) {
      for (let k = 0; k < half; k++) {
        const wr = cos[half + k];
        const wi = sign * sin[half + k];
        const a = start + k;
        const b = a + half;
        const tr = wr * re[b] - wi * im[b];
        const ti = wr * im[b] + wi * re[b];
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
      }
    }
  }
  if (!inverse) return;
  for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

export const nextPowerOfTwo = (n: number): number => 2 ** Math.ceil(Math.log2(Math.max(2, n)));

/**
 * `x` convolved with each of `kernels`, cut to the length of `x`. One transform of `x` serves all
 * kernels, and two real kernels share each further transform as its real and imaginary part.
 */
export function convolveAll(x: Float32Array | Float64Array, kernels: Float64Array[]): Float64Array[] {
  const longest = kernels.reduce((max, kernel) => Math.max(max, kernel.length), 1);
  const n = nextPowerOfTwo(x.length + longest - 1);
  const xr = new Float64Array(n);
  const xi = new Float64Array(n);
  xr.set(x);
  fft(xr, xi);
  const out: Float64Array[] = [];
  for (let pair = 0; pair < kernels.length; pair += 2) {
    const kr = new Float64Array(n);
    const ki = new Float64Array(n);
    kr.set(kernels[pair]);
    if (pair + 1 < kernels.length) ki.set(kernels[pair + 1]);
    fft(kr, ki);
    for (let i = 0; i < n; i++) {
      const r = xr[i] * kr[i] - xi[i] * ki[i];
      ki[i] = xr[i] * ki[i] + xi[i] * kr[i];
      kr[i] = r;
    }
    fft(kr, ki, true);
    out.push(kr.slice(0, x.length));
    if (pair + 1 < kernels.length) out.push(ki.slice(0, x.length));
  }
  return out;
}
