// Echo reduction: statistical late-reverberation suppression (Lebart 2001, Habets 2009).
//
// Compiled to `echo-reduction.wasm` by scripts/echo-dsp.ts and run inside the MAIN-world
// AudioWorklet (src/platform/echo-reduction-worklet.ts). The late reverb in each bin is
// predicted as the smoothed input power `delay` frames ago, decayed by exp(-2 * delta * gap)
// with delta = 3 ln 10 / RT60; a decision-directed Wiener gain with a floor removes it.
// Light and Strong are the same code with different `configure` arguments.
//
// The gain must not flicker. Left alone, each bin switches between the floor and 0 dB on its own,
// and those isolated specks are musical noise: a rustling that sounds like a low-bitrate codec and
// is worst on one, whose spectrum is already patchy (TME-275). So the late estimate averages 30 ms
// of input, and the gain is smoothed across neighbouring bins before it is applied.
//
// Stereo shares one transform: left is the real part and right the imaginary part of one
// complex frame. A real, conjugate-symmetric gain applied to that spectrum scales each
// channel's spectrum alike, so both channels get the same gain and the image stays put.
//
// Frame 1024, hop 256, sqrt-Hann analysis and synthesis. Every call takes one 128-sample
// render quantum, so the added latency is 1024 - 128 = 896 samples (18.7 ms at 48 kHz).
// Keep src/test-utils/echo-reduction-reference.ts in step with any change here.

const N: i32 = 1024;
const HOP: i32 = 256;
const QUANTUM: i32 = 128;
// 513 bins, padded to whole f32x4 lanes; the pad bins carry only the epsilon power.
const BINS: i32 = 516;
const HISTORY: i32 = 32;
// Keeps power and its smoothed history out of the subnormal range during silence.
const EPSILON: f32 = 1e-20;
// Decision-directed weight on the previous frame's direct-sound estimate.
const ALPHA: f32 = 0.9;
// Time constant of the input power smoothing, in seconds. Shorter, and the late estimate is as
// noisy as the frame it is compared with.
const SMOOTHING_SECONDS: f32 = 0.03;

const inputLeft = memory.data(QUANTUM << 2, 16);
const inputRight = memory.data(QUANTUM << 2, 16);
const outputLeft = memory.data(QUANTUM << 2, 16);
const outputRight = memory.data(QUANTUM << 2, 16);

const windowLeft = memory.data(N << 2, 16);
const windowRight = memory.data(N << 2, 16);
const sumLeft = memory.data(N << 2, 16);
const sumRight = memory.data(N << 2, 16);
const readyLeft = memory.data(HOP << 2, 16);
const readyRight = memory.data(HOP << 2, 16);

const real = memory.data(N << 2, 16);
const imag = memory.data(N << 2, 16);
const analysis = memory.data(N << 2, 16);
const synthesis = memory.data(N << 2, 16);
// Per stage `half`, the twiddles of that stage start at index `half`.
const twiddleReal = memory.data(N << 2, 16);
const twiddleImag = memory.data(N << 2, 16);
const reversed = memory.data(N << 2, 16);

const power = memory.data(BINS << 2, 16);
const smoothed = memory.data(BINS << 2, 16);
const direct = memory.data(BINS << 2, 16);
const gain = memory.data(N << 2, 16);
// The gain of each bin before smoothing, with one lane in front for the mirrored bin -1.
const rawGain = memory.data((BINS + 8) << 2, 16) + 16;
const history = memory.data((HISTORY * BINS) << 2, 16);

let pending: i32 = 0;
let readAt: i32 = QUANTUM;
let slot: i32 = 0;
let delayFrames: i32 = 1;
let decay: f32 = 0;
let overSubtraction: f32 = 1;
let floorGain: f32 = 1;
let smoothing: f32 = 0;

@inline function at(base: usize, index: i32): usize {
  return base + (<usize>index << 2);
}

function initTables(): void {
  let bits = 0;
  while ((1 << bits) < N) bits++;
  for (let i = 0; i < N; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    store<i32>(at(reversed, i), r);
    // Periodic Hann: four shifted copies at a quarter-frame hop sum to 2.
    const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * <f64>i) / <f64>N);
    const root = Math.sqrt(hann);
    store<f32>(at(analysis, i), <f32>root);
    store<f32>(at(synthesis, i), <f32>(root * 0.5 / <f64>N));
  }
  for (let half = 1; half < N; half <<= 1) {
    for (let j = 0; j < half; j++) {
      const angle = (Math.PI * <f64>j) / <f64>half;
      store<f32>(at(twiddleReal, half + j), <f32>Math.cos(angle));
      store<f32>(at(twiddleImag, half + j), <f32>-Math.sin(angle));
    }
  }
}

initTables();

/** In-place forward transform; swapping the two arrays gives the unscaled inverse. */
function fft(re: usize, im: usize): void {
  for (let i = 0; i < N; i++) {
    const j = load<i32>(at(reversed, i));
    if (j <= i) continue;
    const ar = load<f32>(at(re, i));
    const ai = load<f32>(at(im, i));
    store<f32>(at(re, i), load<f32>(at(re, j)));
    store<f32>(at(im, i), load<f32>(at(im, j)));
    store<f32>(at(re, j), ar);
    store<f32>(at(im, j), ai);
  }
  for (let half = 1; half < 4; half <<= 1) {
    for (let base = 0; base < N; base += half << 1) {
      for (let j = 0; j < half; j++) {
        const a = base + j;
        const b = a + half;
        const wr = load<f32>(at(twiddleReal, half + j));
        const wi = load<f32>(at(twiddleImag, half + j));
        const br = load<f32>(at(re, b));
        const bi = load<f32>(at(im, b));
        const tr = br * wr - bi * wi;
        const ti = br * wi + bi * wr;
        const ar = load<f32>(at(re, a));
        const ai = load<f32>(at(im, a));
        store<f32>(at(re, b), ar - tr);
        store<f32>(at(im, b), ai - ti);
        store<f32>(at(re, a), ar + tr);
        store<f32>(at(im, a), ai + ti);
      }
    }
  }
  for (let half = 4; half < N; half <<= 1) {
    for (let base = 0; base < N; base += half << 1) {
      for (let j = 0; j < half; j += 4) {
        const a = base + j;
        const b = a + half;
        const wr = v128.load(at(twiddleReal, half + j));
        const wi = v128.load(at(twiddleImag, half + j));
        const br = v128.load(at(re, b));
        const bi = v128.load(at(im, b));
        const tr = f32x4.sub(f32x4.mul(br, wr), f32x4.mul(bi, wi));
        const ti = f32x4.add(f32x4.mul(br, wi), f32x4.mul(bi, wr));
        const ar = v128.load(at(re, a));
        const ai = v128.load(at(im, a));
        v128.store(at(re, b), f32x4.sub(ar, tr));
        v128.store(at(im, b), f32x4.sub(ai, ti));
        v128.store(at(re, a), f32x4.add(ar, tr));
        v128.store(at(im, a), f32x4.add(ai, ti));
      }
    }
  }
}

/** Forgets all audio: the next frames start from silence, as after a fresh start. */
export function reset(): void {
  memory.fill(windowLeft, 0, N << 2);
  memory.fill(windowRight, 0, N << 2);
  memory.fill(sumLeft, 0, N << 2);
  memory.fill(sumRight, 0, N << 2);
  memory.fill(readyLeft, 0, HOP << 2);
  memory.fill(readyRight, 0, HOP << 2);
  memory.fill(smoothed, 0, BINS << 2);
  memory.fill(direct, 0, BINS << 2);
  memory.fill(history, 0, (HISTORY * BINS) << 2);
  pending = 0;
  readAt = QUANTUM;
}

/**
 * `rt60` is the assumed room decay in seconds, `gap` the prediction gap in seconds,
 * `floorDb` the lowest gain. Takes effect on the next frame without clearing state.
 */
export function configure(rt60: f32, overSubtract: f32, floorDb: f32, gap: f32, rate: f32): void {
  const hopSeconds = <f64>HOP / <f64>rate;
  delayFrames = <i32>Math.max(1, Math.min(<f64>(HISTORY - 1), Math.round(<f64>gap / hopSeconds)));
  const delta = (3 * Math.LN10) / <f64>rt60;
  decay = <f32>Math.exp(-2 * delta * <f64>delayFrames * hopSeconds);
  overSubtraction = overSubtract;
  floorGain = <f32>Math.pow(10, <f64>floorDb / 20);
  smoothing = <f32>Math.exp(-hopSeconds / <f64>SMOOTHING_SECONDS);
}

function frame(): void {
  for (let i = 0; i < N; i += 4) {
    const w = v128.load(at(analysis, i));
    v128.store(at(real, i), f32x4.mul(v128.load(at(windowLeft, i)), w));
    v128.store(at(imag, i), f32x4.mul(v128.load(at(windowRight, i)), w));
  }
  fft(real, imag);

  // |L[k]|^2 + |R[k]|^2 from the shared spectrum Z = L + jR: (|Z[k]|^2 + |Z[N-k]|^2) / 2.
  let total: f32 = 0;
  for (let k = 0; k <= N >> 1; k++) {
    const m = (N - k) & (N - 1);
    const r1 = load<f32>(at(real, k));
    const i1 = load<f32>(at(imag, k));
    const r2 = load<f32>(at(real, m));
    const i2 = load<f32>(at(imag, m));
    const p: f32 = 0.5 * (r1 * r1 + i1 * i1 + r2 * r2 + i2 * i2) + EPSILON;
    store<f32>(at(power, k), p);
    total += p;
  }
  if (!isFinite<f32>(total)) {
    // A NaN or infinity would stay in the history; drop everything and start over silent.
    reset();
    return;
  }

  const past = at(history, ((slot - delayFrames + HISTORY) % HISTORY) * BINS);
  const now = at(history, slot * BINS);
  const keep = f32x4.splat(smoothing);
  const take = f32x4.splat(1 - smoothing);
  const decayV = f32x4.splat(decay * overSubtraction);
  const floorV = f32x4.splat(floorGain);
  const alphaV = f32x4.splat(ALPHA);
  const restV = f32x4.splat(1 - ALPHA);
  const oneV = f32x4.splat(1);
  const zeroV = f32x4.splat(0);
  const epsilonV = f32x4.splat(EPSILON);
  for (let k = 0; k < BINS; k += 4) {
    const p = v128.load(at(power, k));
    const s = f32x4.add(f32x4.mul(keep, v128.load(at(smoothed, k))), f32x4.mul(take, p));
    v128.store(at(smoothed, k), s);
    v128.store(now + (<usize>k << 2), s);
    const late = f32x4.add(f32x4.mul(decayV, v128.load(past + (<usize>k << 2))), epsilonV);
    const posterior = f32x4.div(p, late);
    const prior = f32x4.add(
      f32x4.mul(alphaV, f32x4.div(v128.load(at(direct, k)), late)),
      f32x4.mul(restV, f32x4.max(f32x4.sub(posterior, oneV), zeroV))
    );
    const g = f32x4.max(f32x4.div(prior, f32x4.add(prior, oneV)), floorV);
    v128.store(at(direct, k), f32x4.mul(f32x4.mul(g, g), p));
    v128.store(at(rawGain, k), g);
  }
  slot = (slot + 1) % HISTORY;

  // [1 2 1] / 4 across frequency. The gain is even around bins 0 and N/2, which gives both edges
  // their missing neighbour. The decision-directed estimate above keeps the unsmoothed gain.
  store<f32>(rawGain - 4, load<f32>(at(rawGain, 1)));
  store<f32>(at(rawGain, (N >> 1) + 1), load<f32>(at(rawGain, (N >> 1) - 1)));
  const halfV = f32x4.splat(0.5);
  const quarterV = f32x4.splat(0.25);
  for (let k = 0; k < BINS; k += 4) {
    const centre = at(rawGain, k);
    const sides = f32x4.add(v128.load(centre - 4), v128.load(centre + 4));
    v128.store(at(gain, k), f32x4.add(f32x4.mul(halfV, v128.load(centre)), f32x4.mul(quarterV, sides)));
  }
  for (let n = (N >> 1) + 1; n < N; n++) store<f32>(at(gain, n), load<f32>(at(gain, N - n)));

  for (let i = 0; i < N; i += 4) {
    const g = v128.load(at(gain, i));
    v128.store(at(real, i), f32x4.mul(v128.load(at(real, i)), g));
    v128.store(at(imag, i), f32x4.mul(v128.load(at(imag, i)), g));
  }
  fft(imag, real);

  for (let i = 0; i < N; i += 4) {
    const w = v128.load(at(synthesis, i));
    v128.store(at(sumLeft, i), f32x4.add(v128.load(at(sumLeft, i)), f32x4.mul(v128.load(at(real, i)), w)));
    v128.store(at(sumRight, i), f32x4.add(v128.load(at(sumRight, i)), f32x4.mul(v128.load(at(imag, i)), w)));
  }
  memory.copy(readyLeft, sumLeft, HOP << 2);
  memory.copy(readyRight, sumRight, HOP << 2);
  memory.copy(sumLeft, at(sumLeft, HOP), (N - HOP) << 2);
  memory.copy(sumRight, at(sumRight, HOP), (N - HOP) << 2);
  memory.fill(at(sumLeft, N - HOP), 0, HOP << 2);
  memory.fill(at(sumRight, N - HOP), 0, HOP << 2);
}

/** Consumes one quantum from the input buffers and fills the output buffers. */
export function process(): void {
  memory.copy(at(windowLeft, N - HOP + pending), inputLeft, QUANTUM << 2);
  memory.copy(at(windowRight, N - HOP + pending), inputRight, QUANTUM << 2);
  pending += QUANTUM;
  if (pending == HOP) {
    frame();
    memory.copy(windowLeft, at(windowLeft, HOP), (N - HOP) << 2);
    memory.copy(windowRight, at(windowRight, HOP), (N - HOP) << 2);
    pending = 0;
    readAt = 0;
  }
  memory.copy(outputLeft, at(readyLeft, readAt), QUANTUM << 2);
  memory.copy(outputRight, at(readyRight, readAt), QUANTUM << 2);
  readAt += QUANTUM;
}

export function inputBuffer(channel: i32): usize {
  return channel == 0 ? inputLeft : inputRight;
}

export function outputBuffer(channel: i32): usize {
  return channel == 0 ? outputLeft : outputRight;
}

/** The gain applied to the latest frame, bins 0 to N/2. Read by tests and offline measurement only. */
export function gainBuffer(): usize {
  return gain;
}

export const QUANTUM_FRAMES = QUANTUM;
export const LATENCY_FRAMES = N - QUANTUM;
