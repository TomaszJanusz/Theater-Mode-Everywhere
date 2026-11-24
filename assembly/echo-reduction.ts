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
// The voice must survive. The preset's estimate is a fixed share of whatever sounded `delay` frames
// ago, so on its own it takes every sound that lasts as its own echo and turns each vowel down after
// its onset, the same on a dry recording as in a hall (TME-279). Two things per band keep it honest:
// - `remain` learns how much of a band's power is really left `delay` frames later when nothing
//   feeds the band. It follows a low quantile of (power now) / (power then): free decays are the
//   lowest values that ratio takes, so the quantile sits on them. It can only lower the estimate.
// - A band whose power stands well above what `remain` predicts is being fed by a source. While it
//   is, the band gets the learned estimate and a shallow floor; in the decay after it, the preset's
//   estimate and floor apply as before. Steady sound keeps `remain` at 1 and is treated as before.
//   A band can only become fed while its power rises, and within 30 dB of the loudest it has lately
//   been: the long, weak tail of a hall after a close voice, and the hum of a recording once the echo
//   has faded, also stand above the prediction, but neither is an onset of anything worth protecting.
//   "Lately" lasts through the pauses of speech and no longer, or a quiet scene after a loud one would
//   be taken for the pauses of the loud one.
// - When even the lowest ratio of the last second stands well above `remain`, several decays in a row
//   have contradicted it: the scene has changed, and `remain` catches up fast instead of drifting.
//
// Only the echo of speech is its business. Music, effects and ambience are no echo, so the gain
// stays at exactly 1 for them wherever the DSP can tell:
// - It acts in the speech bands only, 80 Hz to 4.8 kHz: from under the lowest fundamental of a voice
//   (a male voice reaches down to 85 Hz) to the edge of the band layout above the third formant.
//   Bins outside are never computed and their gain is never written. The edges are one bin (47 Hz)
//   wide, as any edge between bins is: a tone that close to one is carried partly by bins inside.
// - It acts only after speech. The cue is a syllable as the level of the speech bands shows it, each
//   band weighed against its own recent peak: the level rises over the gap, as a fed band starts,
//   and then holds for a moment instead of falling at once. A voice does that in a dry recording
//   and in a hall; steady or slowly moving sound never rises, and a drum or a plucked string falls
//   from its first moment. The gain is free to fall while a syllable sounds and for 0.8 s after it,
//   long enough for a long word and the audible part of its tail, and returns to 1 over 0.4 s more.
// - It acts only on what falls. An echo dies away; music that plays on under a voice, or after a
//   chord was struck over it, holds its level. So the gain is free only while the level of the
//   speech bands is falling and for 0.1 s after. This is also what keeps the voice itself: a vowel
//   that holds is not turned down.
// - It acts as far as it is sure. One syllable that hardly stands out from the sound around it may
//   be a chord accent, and gets two fifths of the depth. One that lasts, or one that stands 15 dB
//   clear of what sounded before it, gets all of it. So does a run of them, but only where each
//   sounds different from the one before: vowels move the level from band to band, and a chord
//   struck again and again over music keeps its shape and adds nothing.
// None of this hears a voice. An instrument whose notes are as long as syllables and change their
// colour from one to the next passes for one; a word shorter than a tenth of a second on its own
// does not count; and a voice under louder music moves the level too little to be found.
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

// The speech bands, which are also the bands of the learned decay: 80-300 Hz, then four octaves.
const BANDS: i32 = 5;
const SPEECH_FROM_HZ: f64 = 80;
const FIRST_EDGE_HZ: f64 = 300;
// `remain` follows the 10 % quantile of the power ratio: nine steps up cancel one step down.
const FALL_DB_PER_SECOND: f64 = 37.5;
const RISE_DB_PER_SECOND: f64 = FALL_DB_PER_SECOND / 9;
// The quantile sits inside the decays; the estimate is kept this far (2.5 dB) above it.
const HEADROOM: f32 = 1.7782794;
// -25 dB: a dry recording. Lower would only slow the way back up after a change of scene.
const REMAIN_MIN: f32 = 0.0031622777;
// Frames whose band power is 40 dB below the band's slow peak (0.6 dB/s) say nothing about decays.
const GATE: f32 = 1e-4;
const PEAK_FALL_DB_PER_SECOND: f64 = 0.6;
// A band is fed from 2 times (3 dB) what `remain` predicts, fully at 6 times (7.8 dB).
const FED_FROM: f32 = 2;
const FED_SPAN: f32 = 4;
// How long a band stays fed after its source stops, seconds: long enough for the end of a word.
const RELEASE_SECONDS: f64 = 0.025;
// A band starts being fed while its power rises 1.5 to 2.5 times (1.8 to 4 dB) over the gap, and can
// return to it without a rise only while it is still at least 5 to 10 % fed.
const RISE_FROM: f32 = 1.5;
const KEEP_FROM: f32 = 0.05;
const KEEP_SLOPE: f32 = 20;
// ...and only within 30 dB of `loud`, the loudest the band has lately been (fully from 27 dB).
const START_GATE: f32 = 1e-3;
// `loud` falls like the slow peak until the band has stayed 20 dB below it for 1.25 s, longer than a
// pause between sentences, and from then on at 60 dB/s until the band comes within 20 dB of it again.
// A shorter hold lets the hum between words back in; a common peak with `remain`'s gate would have
// every long pause teach `remain` the hum.
const QUIET: f32 = 1e-2;
const HOLD_SECONDS: f32 = 1.25;
const HOLD_SPAN_SECONDS: f32 = 0.25;
const LOUD_FALL_DB_PER_SECOND: f64 = 60;
// The lowest evidence of the recent past forgets at 12 dB/s, so it spans about a second of decays.
// `remain` is stale when that minimum stands 2 to 4 times above it, and then rises at up to 30 dB/s.
const LOW_RISE_DB_PER_SECOND: f64 = 12;
const STALE_RISE_DB_PER_SECOND: f64 = 30;
const STALE_FROM: f32 = 2;
const STALE_SPAN: f32 = 2;
// The floor of a fed band, as a fraction of the preset's floor in dB (-7 dB gives -2.1 dB).
const CAP_RATIO: f64 = 0.3;
// The gain may fall for this long after the last syllable in the speech bands, and is back at 1 this much later.
const TAIL_SECONDS: f32 = 0.8;
const TAIL_FADE_SECONDS: f32 = 0.4;
// A band counts towards the level of the speech bands by its power against its own recent peak plus
// 1 % of all the bands' peaks: a band that holds only the noise floor of the recording counts for nothing.
const PEAKS_SHARE: f32 = 0.01;
// A rise counts from a level of 1 % (fully from 2 %): the hum of a recording and the far end of a
// tail swell too, and neither is speech.
const SPEECH_GATE: f32 = 0.01;
// Rise and fall are read from the change of the level over the gap, smoothed with this time constant
// (seconds: three tenths of each new frame at 48 kHz) and never counted above 4: the level of steady
// noise jumps for a frame or two, and a sound that starts stands above its past for the whole gap.
const TREND_SECONDS: f64 = 0.014953;
const TREND_TOP: f32 = 4;
const REFERENCE_HOP_RATE: f64 = 187.5;
// The rise is remembered this long (time constant, seconds) while the level shows whether it holds.
const RISE_MEMORY_SECONDS: f64 = 0.08;
// The level holds while it loses less than 40 % (2.2 dB) over the gap, fully while it loses less than
// 20 % (1 dB). A room lets a word fall faster than that when it ends, and so does a drum from its start.
const HOLD_FROM: f32 = 0.6;
const HOLD_SLOPE: f32 = 5;
// A syllable has held for 7 ms after its rise (fully for 19 ms). The rise itself takes the gap and
// both smoothings to pass, so the sound has lasted about a tenth of a second by then. A note that
// falls at 50 dB/s holds for one frame; with less than 7 ms it would count, and with more than
// 19 ms short syllables in a dry room would not.
const SYLLABLE_FROM: f32 = 0.007;
const SYLLABLE_SPAN: f32 = 0.012;
// ...while at least a fifth of a full rise is still remembered (fully from two fifths), which leaves
// out the little of both that a note falling a bit more slowly shows.
const CLEAR_FROM: f32 = 0.2;
const CLEAR_SLOPE: f32 = 5;
// A syllable sounds on until the speech bands have lost half their power over the gap (it is over
// at two fifths, 4 dB down): a held vowel wavers by 2 dB and keeps counting. It sounds for this many
// seconds at most: a note held longer is not one. It counts in full until its last tenth of a second.
const GONE_FROM: f32 = 0.4;
const GONE_SLOPE: f32 = 5;
const SYLLABLE_SECONDS: f32 = 2;
const SOUNDING_SLOPE: f32 = 10;
// The level is falling when the smoothed change shows it 15 % lower than before the gap (fully at
// 25 %, which a room with an RT60 of 2.9 s does). The gain stays free this long after, seconds.
const FALL_FROM: f32 = 0.85;
const FALL_SLOPE: f32 = 10;
const FALLING_SECONDS: f32 = 0.1;
// How sure the DSP is that it hears speech, 0 to 1, with 0.3 to spare. A syllable adds two fifths
// when it has another shape than the one counted before it: the levels of the bands, each against
// its own peak, differ by 0.6 in all (nothing below 0.4). Chord accents repeated over sustained
// music differ by 0.15 to 0.45, the built-in voice in a 1.5 s room by 0.5 to 1.4. It adds up to
// three fifths more when the speech bands are 8 to 32 times (9 to 15 dB) louder than before its
// rise, whatever its shape: there is nothing else sounding to mistake it for. What sounded before
// a rise is kept until a twentieth of the rise is left in memory, 0.24 s on. Every second a
// syllable sounds adds 1, and every second takes 0.5 away: accents of 180 ms twice a second do not
// add up by their length alone, and a vowel held for a second does.
const SURE_STEP: f32 = 0.4;
const CLEAR_OF_FROM: f32 = 8;
const CLEAR_OF_SPAN: f32 = 24;
const RISE_KEPT: f32 = 20;
const NEW_SHAPE_FROM: f32 = 0.4;
const NEW_SHAPE_SPAN: f32 = 0.2;
const SURE_RISE: f32 = 1;
const SURE_FALL: f32 = 0.5;
const SURE_TOP: f32 = 1.3;

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
// Per bin, the share of the past power taken as late reverb and the lowest gain, refilled per band.
const share = memory.data(BINS << 2, 16);
const floors = memory.data(BINS << 2, 16);
const bandStart = memory.data((BANDS + 1) << 2, 4);
const remain = memory.data(BANDS << 2, 4);
const fed = memory.data(BANDS << 2, 4);
const peak = memory.data(BANDS << 2, 4);
// The lowest evidence (ratio times headroom) each band has shown lately.
const lowest = memory.data(BANDS << 2, 4);
// The peak the start of a fed band is judged against, and for how many seconds the band has stayed far below it.
const loud = memory.data(BANDS << 2, 4);
const quiet = memory.data(BANDS << 2, 4);
// How loud each band was against its own peak in the syllable counted last.
const shape = memory.data(BANDS << 2, 4);

let pending: i32 = 0;
let readAt: i32 = QUANTUM;
let slot: i32 = 0;
// The whole f32x4 lanes that hold the speech bands: the only bins a frame computes.
let laneFrom: i32 = 0;
let laneTo: i32 = 0;
// Seconds since the last syllable in the speech bands, up to the end of the fade.
let sinceSpeech: f32 = 0;
// The smoothed change of the speech bands' level over the gap, its latest rise, fading, for how many
// seconds the level has held since, and for how many more a syllable may sound on.
let trend: f32 = 1;
let risen: f32 = 0;
let held: f32 = 0;
let sounding: f32 = 0;
// How far the level is falling or has just fallen; how sure the DSP is of speech; whether the latest
// rise has still to be counted as a syllable, and how much of one the last frame counted; and the
// power of the speech bands before that rise.
let sinking: f32 = 0;
let sure: f32 = 0;
let fresh: f32 = 0;
let counting: f32 = 0;
let quietBefore: f32 = 0;
// The sum of the bands' recent peaks (`loud`) after the previous frame.
let peaks: f32 = 0;
let delayFrames: i32 = 1;
// The preset's share of the past power: decay over the gap times the over-subtraction.
let presetShare: f32 = 0;
let floorGain: f32 = 1;
let capGain: f32 = 1;
let smoothing: f32 = 0;
let fall: f32 = 1;
let rise: f32 = 1;
let peakFall: f32 = 1;
let release: f32 = 0;
let riseFade: f32 = 0;
let trendShare: f32 = 0;
// The hop in units of the hop at 48 kHz, which the syllable's per-frame rules were set for.
let pace: f32 = 1;
let lowRise: f32 = 1;
let staleRise: f32 = 1;
let loudFall: f32 = 1;
let hopTime: f32 = 0;

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

/**
 * Places the band edges for a sample rate; a band above half the rate is left empty. Every bin
 * outside the bands gets a gain of 1 here and keeps it: no frame writes it again.
 */
function layout(rate: f64): void {
  let edge = SPEECH_FROM_HZ;
  for (let b = 0; b <= BANDS; b++) {
    store<i32>(at(bandStart, b), <i32>Math.min(<f64>((N >> 1) + 1), Math.ceil((edge * <f64>N) / rate)));
    edge = b == 0 ? FIRST_EDGE_HZ : edge * 2;
  }
  laneFrom = load<i32>(bandStart) & ~3;
  laneTo = (load<i32>(at(bandStart, BANDS)) + 3) & ~3;
  bandFill(gain, 0, N, 1);
}

layout(48000);

/** Forgets what was learned about the recording: every band starts from the preset's assumption. */
function forget(): void {
  for (let b = 0; b < BANDS; b++) {
    store<f32>(at(remain, b), 1);
    store<f32>(at(fed, b), 0);
    store<f32>(at(peak, b), 0);
    store<f32>(at(lowest, b), 1);
    store<f32>(at(loud, b), 0);
    store<f32>(at(quiet, b), 0);
  }
  sinceSpeech = TAIL_SECONDS + TAIL_FADE_SECONDS;
  trend = 1;
  risen = 0;
  held = 0;
  sounding = 0;
  sinking = 0;
  sure = 0;
  fresh = 0;
  counting = 0;
  memory.fill(shape, 0, BANDS << 2);
  quietBefore = 0;
  peaks = 0;
}

forget();

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
  forget();
  pending = 0;
  readAt = QUANTUM;
}

/**
 * `rt60` is the assumed room decay in seconds, `gap` the prediction gap in seconds,
 * `floorDb` the lowest gain. Takes effect on the next frame without clearing state: what was
 * learned about the recording belongs to the recording, not to the level.
 */
export function configure(rt60: f32, overSubtract: f32, floorDb: f32, gap: f32, rate: f32): void {
  const hopSeconds = <f64>HOP / <f64>rate;
  delayFrames = <i32>Math.max(1, Math.min(<f64>(HISTORY - 1), Math.round(<f64>gap / hopSeconds)));
  const delta = (3 * Math.LN10) / <f64>rt60;
  presetShare = <f32>(Math.exp(-2 * delta * <f64>delayFrames * hopSeconds) * <f64>overSubtract);
  floorGain = <f32>Math.pow(10, <f64>floorDb / 20);
  capGain = <f32>Math.pow(10, (CAP_RATIO * <f64>floorDb) / 20);
  smoothing = <f32>Math.exp(-hopSeconds / <f64>SMOOTHING_SECONDS);
  fall = <f32>Math.pow(10, (-FALL_DB_PER_SECOND * hopSeconds) / 10);
  rise = <f32>Math.pow(10, (RISE_DB_PER_SECOND * hopSeconds) / 10);
  peakFall = <f32>Math.pow(10, (-PEAK_FALL_DB_PER_SECOND * hopSeconds) / 10);
  release = <f32>Math.exp(-hopSeconds / RELEASE_SECONDS);
  riseFade = <f32>Math.exp(-hopSeconds / RISE_MEMORY_SECONDS);
  trendShare = <f32>(1 - Math.exp(-hopSeconds / TREND_SECONDS));
  pace = <f32>(hopSeconds * REFERENCE_HOP_RATE);
  lowRise = <f32>Math.pow(10, (LOW_RISE_DB_PER_SECOND * hopSeconds) / 10);
  staleRise = <f32>Math.pow(10, (STALE_RISE_DB_PER_SECOND * hopSeconds) / 10);
  loudFall = <f32>Math.pow(10, (-LOUD_FALL_DB_PER_SECOND * hopSeconds) / 10);
  hopTime = <f32>hopSeconds;
  layout(<f64>rate);
}

/** Sum of bins `from` to `to` (exclusive) of a 16-byte aligned array. */
function bandSum(base: usize, from: i32, to: i32): f32 {
  let sum: f32 = 0;
  let k = from;
  for (; k < to && (k & 3) != 0; k++) sum += load<f32>(at(base, k));
  let lanes = f32x4.splat(0);
  for (; k + 4 <= to; k += 4) lanes = f32x4.add(lanes, v128.load(at(base, k)));
  sum += f32x4.extract_lane(lanes, 0) + f32x4.extract_lane(lanes, 1) + f32x4.extract_lane(lanes, 2) + f32x4.extract_lane(lanes, 3);
  for (; k < to; k++) sum += load<f32>(at(base, k));
  return sum;
}

function bandFill(base: usize, from: i32, to: i32, value: f32): void {
  let k = from;
  for (; k < to && (k & 3) != 0; k++) store<f32>(at(base, k), value);
  const lanes = f32x4.splat(value);
  for (; k + 4 <= to; k += 4) v128.store(at(base, k), lanes);
  for (; k < to; k++) store<f32>(at(base, k), value);
}

@inline function unit(value: f32): f32 {
  return max<f32>(0, min<f32>(1, value));
}

/**
 * What is left of a value after one frame that keeps the share `stays` of it per 5.33 ms, the hop
 * at 48 kHz. Whatever the hop of this sample rate, the same time takes away about the same share:
 * a frame half as long takes half as much.
 */
function kept(stays: f32): f32 {
  return max<f32>(0, 1 - pace * (1 - stays));
}

/**
 * Per band: learn `remain` from this frame, decide how far the band is fed by a source, and set the
 * share of the past power taken as late reverb and the floor for its bins. Across the bands: find
 * the syllables that let the floors below 1. No step here is a hard decision, so the float32 build
 * and the float64 reference cannot part ways on a tie.
 */
function bands(past: usize): void {
  // How far the gain may fall in this frame: all the way until `TAIL_SECONDS` after the last syllable
  // and then less and less, while the level falls, as far as the DSP is sure of speech.
  const tail = unit((TAIL_SECONDS + TAIL_FADE_SECONDS - sinceSpeech) / TAIL_FADE_SECONDS) * sinking * unit(sure);
  let level: f32 = 0;
  let before: f32 = 0;
  let recentPeaks: f32 = 0;
  let totalNow: f32 = 0;
  let apart: f32 = 0;
  let totalWas: f32 = 0;
  for (let b = 0; b < BANDS; b++) {
    const from = load<i32>(at(bandStart, b));
    const to = load<i32>(at(bandStart, b + 1));
    const now = bandSum(power, from, to);
    const was = bandSum(past, from, to) + EPSILON * <f32>(to - from + 1);
    const ratio = now / was;
    const top = max<f32>(was, load<f32>(at(peak, b)) * peakFall);
    store<f32>(at(peak, b), top);
    // Open from the gate to 3 dB above it; the step turns from down to up within 10 % of `remain`.
    const open = unit(was / (top * GATE + EPSILON) - 1);
    let left = load<f32>(at(remain, b));
    const evidence = ratio * HEADROOM;
    const turn = unit((evidence / left - 0.9) * 5);
    let low = load<f32>(at(lowest, b));
    low = max<f32>(REMAIN_MIN, min<f32>(1, low + open * (min<f32>(evidence, low * lowRise) - low)));
    store<f32>(at(lowest, b), low);
    const up = rise + (staleRise - rise) * unit((low / left - STALE_FROM) / STALE_SPAN);
    left = max<f32>(REMAIN_MIN, min<f32>(1, left * (1 + open * (fall + (up - fall) * turn - 1))));
    store<f32>(at(remain, b), left);
    const heard = load<f32>(at(loud, b));
    // Each band counts by how loud it is against its own recent peak, so the level of the speech
    // bands is not that of the one band that carries most of the power.
    const weight: f32 = 1 / (heard + now + PEAKS_SHARE * peaks + EPSILON);
    // The shape of a syllable: how loud each band is against its own peak, kept from the one counted last.
    const part = now * weight;
    const last = load<f32>(at(shape, b));
    apart += abs<f32>(part - last);
    store<f32>(at(shape, b), last + counting * (part - last));
    level += part;
    before += was * weight;
    totalNow += now;
    totalWas += was;
    const still = min<f32>(unit(2 - now / (heard * QUIET + EPSILON)) * (load<f32>(at(quiet, b)) + hopTime), HOLD_SECONDS + HOLD_SPAN_SECONDS);
    store<f32>(at(quiet, b), still);
    const recent = max<f32>(was, heard * (peakFall + (loudFall - peakFall) * unit((still - HOLD_SECONDS) / HOLD_SPAN_SECONDS)));
    store<f32>(at(loud, b), recent);
    recentPeaks += recent;
    const feeding = load<f32>(at(fed, b));
    const onset = unit(ratio - RISE_FROM) * unit(now / (recent * START_GATE + EPSILON) - 1);
    const start = max<f32>(onset, unit((feeding - KEEP_FROM) * KEEP_SLOPE));
    const source = max<f32>(unit((ratio / left - FED_FROM) / FED_SPAN) * start, feeding * release);
    store<f32>(at(fed, b), source);
    bandFill(share, from, to, presetShare + (min<f32>(left, presetShare) - presetShare) * source);
    bandFill(floors, from, to, 1 + (floorGain + (capGain - floorGain) * source - 1) * tail);
  }
  peaks = recentPeaks;
  // A syllable: the level of the speech bands rises as a fed band does, and holds. `level` is at most
  // `BANDS` and no divisor zero, so every ratio here is finite or infinite, never undefined.
  const change = level / (before + EPSILON);
  trend += trendShare * (min<f32>(change, TREND_TOP) - trend);
  const rising = unit(trend - RISE_FROM);
  risen = max<f32>(rising * unit(level / SPEECH_GATE - 1), risen * riseFade);
  // Counted from the end of the rise, so that the quiet before a sound does not count as holding.
  held = (held + hopTime) * kept(unit((change - HOLD_FROM) * HOLD_SLOPE) * (1 - rising));
  const syllable = unit((risen * unit((held - SYLLABLE_FROM) / SYLLABLE_SPAN) - CLEAR_FROM) * CLEAR_SLOPE);
  // It sounds on until the bands lose their power, for `SYLLABLE_SECONDS` at most (less for a weak one).
  sounding = max<f32>(sounding - hopTime, syllable * SYLLABLE_SECONDS) * kept(unit((totalNow / (totalWas + EPSILON) - GONE_FROM) * GONE_SLOPE));
  const spoken = unit(sounding * SOUNDING_SLOPE);
  // Half a syllable frees the gain for half as long, and no number of weak ones adds up to a whole.
  sinceSpeech = min<f32>(sinceSpeech, (TAIL_SECONDS + TAIL_FADE_SECONDS) * (1 - spoken)) + hopTime;
  sinking = max<f32>(unit((FALL_FROM - trend) * FALL_SLOPE), sinking - hopTime / FALLING_SECONDS);
  // Each rise counts once, by how far it lifted the speech bands above what sounded before it, and
  // only as a syllable of another shape than the last.
  quietBefore += (1 - unit(risen * RISE_KEPT)) * (totalWas - quietBefore);
  const step = SURE_STEP * unit((apart - NEW_SHAPE_FROM) / NEW_SHAPE_SPAN) + (1 - SURE_STEP) * unit((totalNow / (quietBefore + EPSILON) - CLEAR_OF_FROM) / CLEAR_OF_SPAN);
  counting = min<f32>(syllable * fresh * pace, 1);
  sure = max<f32>(min<f32>(sure + step * counting + hopTime * (spoken * SURE_RISE - SURE_FALL), SURE_TOP), 0);
  fresh = max<f32>(fresh, rising) * kept(1 - syllable);
}

function frame(): void {
  for (let i = 0; i < N; i += 4) {
    const w = v128.load(at(analysis, i));
    v128.store(at(real, i), f32x4.mul(v128.load(at(windowLeft, i)), w));
    v128.store(at(imag, i), f32x4.mul(v128.load(at(windowRight, i)), w));
  }
  fft(real, imag);

  // |L[k]|^2 + |R[k]|^2 from the shared spectrum Z = L + jR: (|Z[k]|^2 + |Z[N-k]|^2) / 2.
  // A non-finite sample reaches every bin of its frame, so these bins answer for all of them.
  let total: f32 = 0;
  for (let k = laneFrom; k < laneTo; k++) {
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
  bands(past);
  const keep = f32x4.splat(smoothing);
  const take = f32x4.splat(1 - smoothing);
  const alphaV = f32x4.splat(ALPHA);
  const restV = f32x4.splat(1 - ALPHA);
  const oneV = f32x4.splat(1);
  const zeroV = f32x4.splat(0);
  const epsilonV = f32x4.splat(EPSILON);
  for (let k = laneFrom; k < laneTo; k += 4) {
    const p = v128.load(at(power, k));
    const s = f32x4.add(f32x4.mul(keep, v128.load(at(smoothed, k))), f32x4.mul(take, p));
    v128.store(at(smoothed, k), s);
    v128.store(now + (<usize>k << 2), s);
    const late = f32x4.add(f32x4.mul(v128.load(at(share, k)), v128.load(past + (<usize>k << 2))), epsilonV);
    const posterior = f32x4.div(p, late);
    const prior = f32x4.add(
      f32x4.mul(alphaV, f32x4.div(v128.load(at(direct, k)), late)),
      f32x4.mul(restV, f32x4.max(f32x4.sub(posterior, oneV), zeroV))
    );
    // prior / (prior + 1), written so that an overflowing prior gives 1 and not infinity over infinity.
    const g = f32x4.max(f32x4.sub(oneV, f32x4.div(oneV, f32x4.add(prior, oneV))), v128.load(at(floors, k)));
    v128.store(at(direct, k), f32x4.mul(f32x4.mul(g, g), p));
    v128.store(at(rawGain, k), g);
  }
  slot = (slot + 1) % HISTORY;

  // [1 2 1] / 4 across frequency. The lowest bin of the speech bands holds the fundamental of a low
  // voice, and its neighbour below stays at 1, which would halve what that bin takes off: it is
  // smoothed against itself. The bin above the bands counts as 1, or at N/2 as its mirror image.
  // The decision-directed estimate above keeps the unsmoothed gain.
  const first = load<i32>(bandStart);
  const end = load<i32>(at(bandStart, BANDS));
  store<f32>(at(rawGain, first - 1), load<f32>(at(rawGain, first)));
  store<f32>(at(rawGain, end), 1);
  store<f32>(at(rawGain, (N >> 1) + 1), load<f32>(at(rawGain, (N >> 1) - 1)));
  const halfV = f32x4.splat(0.5);
  const quarterV = f32x4.splat(0.25);
  for (let k = laneFrom; k < laneTo; k += 4) {
    const centre = at(rawGain, k);
    const sides = f32x4.add(v128.load(centre - 4), v128.load(centre + 4));
    v128.store(at(gain, k), f32x4.add(f32x4.mul(halfV, v128.load(centre)), f32x4.mul(quarterV, sides)));
  }
  // The lanes hold a few bins beyond the speech bands; their gain is 1.
  bandFill(gain, laneFrom, first, 1);
  bandFill(gain, end, laneTo, 1);
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
