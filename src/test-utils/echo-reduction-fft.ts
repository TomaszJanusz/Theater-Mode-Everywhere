/**
 * The transform of the float64 echo-reduction reference: a recursive FFT on plain arrays, naive on
 * purpose, so that it shares nothing with the in-place SIMD transform it is compared against.
 */
type Complex = { re: number[]; im: number[] };

export function fft(re: number[], im: number[], inverse: boolean): Complex {
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
