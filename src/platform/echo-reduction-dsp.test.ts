import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { referenceEchoReduction } from '../test-utils/echo-reduction-reference';

import { ECHO_PRESETS, type EchoPreset } from './echo-reduction-presets';

const RATE = 48000;
const QUANTUM = 128;
const LATENCY = 896;
const GAIN_BINS = 513;
// The shipped binary, not a fresh build: verify:bundles proves it matches its source.
const BINARY = readFileSync(new URL('../../assembly/echo-reduction.wasm', import.meta.url));

type Dsp = {
  memory: WebAssembly.Memory;
  configure(rt60: number, overSubtraction: number, floorDb: number, gap: number, rate: number): void;
  reset(): void;
  process(): void;
  inputBuffer(channel: number): number;
  outputBuffer(channel: number): number;
  gainBuffer(): number;
  LATENCY_FRAMES: WebAssembly.Global;
};
/** Receives the gain of bins 0 to 512 after each frame, with the time the frame's newest input sample has. */
type GainProbe = (gain: Float32Array, seconds: number) => void;

function configure(dsp: Dsp, preset: EchoPreset, rate = RATE): void {
  dsp.configure(preset.rt60, preset.overSubtraction, preset.floorDb, preset.gap, rate);
}

function instantiate(preset: EchoPreset, rate = RATE): Dsp {
  const { exports } = new WebAssembly.Instance(new WebAssembly.Module(BINARY), {});
  const dsp = exports as unknown as Dsp;
  configure(dsp, preset, rate);
  return dsp;
}

function run(dsp: Dsp, left: Float64Array, right: Float64Array, probe?: GainProbe, before?: (seconds: number) => void): [Float64Array, Float64Array] {
  const view = (pointer: number) => new Float32Array(dsp.memory.buffer, pointer, QUANTUM);
  const [inL, inR, outL, outR] = [dsp.inputBuffer(0), dsp.inputBuffer(1), dsp.outputBuffer(0), dsp.outputBuffer(1)].map(view);
  const gain = new Float32Array(dsp.memory.buffer, dsp.gainBuffer(), GAIN_BINS);
  const out: [Float64Array, Float64Array] = [new Float64Array(left.length), new Float64Array(left.length)];
  for (let start = 0; start + QUANTUM <= left.length; start += QUANTUM) {
    before?.(start / RATE);
    inL.set(left.subarray(start, start + QUANTUM));
    inR.set(right.subarray(start, start + QUANTUM));
    dsp.process();
    out[0].set(outL, start);
    out[1].set(outR, start);
    // A frame is transformed on every second quantum.
    if (probe && (start / QUANTUM) % 2 === 1) probe(gain, (start + QUANTUM) / RATE);
  }
  return out;
}

/**
 * How restless a run of gain frames is, over 190 Hz to 16 kHz: the mean step in dB between
 * neighbouring bins (`across`) and between consecutive frames (`along`), and the share of bins
 * standing 6 dB or more above both bins 140 Hz away (`specks`). Specks are what musical noise is made of.
 */
function restlessness(frames: Float32Array[]) {
  const level = frames.map(frame => Array.from(frame, value => 20 * Math.log10(value)));
  let across = 0;
  let along = 0;
  let specks = 0;
  let cells = 0;
  for (const [f, frame] of level.entries()) {
    for (let k = 4; k < 340; k++) {
      across += Math.abs(frame[k + 1] - frame[k]);
      if (f > 0) along += Math.abs(frame[k] - level[f - 1][k]);
      if (frame[k] - Math.max(frame[k - 3], frame[k + 3]) > 6) specks++;
      cells++;
    }
  }
  return { across: across / cells, along: along / (cells - 336), specks: 100 * specks / cells };
}

/** Deterministic noise in [-1, 1). */
function noise(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 31 - 1;
  };
}

/**
 * The dry signal plus an exponentially decaying noise tail with RT60 `rt60`, different per channel
 * like a real room. Early reflections arrive with the direct sound; the diffuse tail starts after 5 ms.
 */
function inRoom(dry: Float64Array, rt60: number): [Float64Array, Float64Array] {
  const length = Math.round(rt60 * RATE);
  const k = 3 * Math.LN10 / rt60;
  const channels = [noise(1), noise(2)].map(next => {
    const impulse = new Float64Array(length);
    for (let i = Math.round(0.005 * RATE); i < length; i++) impulse[i] = 0.12 * next() * Math.exp(-k * i / RATE);
    const wet = new Float64Array(dry.length);
    // A sparse convolution keeps the test fast; every 32nd tap still makes a dense, decaying tail.
    for (let tap = 0; tap < length; tap += 32) {
      const h = impulse[tap] * Math.sqrt(32);
      if (h === 0) continue;
      for (let i = tap; i < dry.length; i++) wet[i] += h * dry[i - tap];
    }
    return wet.map((value, i) => value + dry[i]);
  });
  return [channels[0], channels[1]];
}

/**
 * The 0.3 s room of TME-275: the direct sound, six reflections within 45 ms and a diffuse tail that
 * starts at 50 ms, with the direct sound 4 dB above everything after it. Different per channel.
 */
function inShortRoom(dry: Float64Array): [Float64Array, Float64Array] {
  const rt60 = 0.3;
  const k = 3 * Math.LN10 / rt60;
  const channels = [noise(31), noise(32)].map(next => {
    const taps: [number, number][] = [];
    let early = 0;
    for (let r = 0; r < 6; r++) {
      const at = Math.round((0.004 + 0.0205 * (next() + 1)) * RATE);
      const gain = 0.35 * next();
      taps.push([at, gain]);
      early += gain ** 2;
    }
    const tail: [number, number][] = [];
    let energy = 0;
    // Every 32nd tap, as in `inRoom`.
    for (let tap = Math.round(0.05 * RATE); tap < 1.6 * rt60 * RATE; tap += 32) {
      const h = next() * Math.exp(-k * tap / RATE) * Math.sqrt(32);
      tail.push([tap, h]);
      energy += h ** 2;
    }
    const scale = Math.sqrt(Math.max(10 ** -0.4 - early, 1e-6) / energy);
    const wet = Float64Array.from(dry);
    for (const [tap, h] of [...taps, ...tail.map(([at, h]): [number, number] => [at, h * scale])]) {
      for (let i = tap; i < dry.length; i++) wet[i] += h * dry[i - tap];
    }
    return wet;
  });
  return [channels[0], channels[1]];
}

/**
 * Speech-like bursts (noise with a falling spectrum, 250 ms on, 350 ms off) in a room: the dry
 * signal plus the tail of `inRoom`. Noise keeps the tail uncorrelated with the dry voice, so a
 * projection measures what is left of it.
 */
function reverberantBursts(seconds: number, rt60: number) {
  const n = Math.round(seconds * RATE);
  const dry = new Float64Array(n);
  const source = noise(3);
  let low = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const on = t % 0.6 < 0.25 ? Math.min(1, (t % 0.6) / 0.005, (0.25 - t % 0.6) / 0.005) : 0;
    low += 0.2 * (source() - low);
    dry[i] = 0.4 * on * low;
  }
  const [left, right] = inRoom(dry, rt60);
  return { dry, left, right };
}

/** Energy of `signal` (shifted back by `delay`) over the samples where `select(t)` holds, after `skip` seconds. */
function energy(signal: Float64Array, delay: number, select: (t: number) => boolean, skip = 1): number {
  let sum = 0;
  for (let i = Math.round(skip * RATE); i + delay < signal.length; i++) {
    if (select(i / RATE)) sum += signal[i + delay] ** 2;
  }
  return sum;
}

const dB = (value: number, reference: number) => 10 * Math.log10(value / reference);

/** How much of the dry voice survives in `output` during the bursts: its least-squares gain on the dry signal. */
function projection(output: Float64Array, dry: Float64Array, delay: number): number {
  let cross = 0;
  let own = 0;
  for (let i = RATE; i + delay < output.length; i++) {
    if (!inBurst(i / RATE)) continue;
    cross += output[i + delay] * dry[i];
    own += dry[i] ** 2;
  }
  return cross / own;
}
// The middle of each burst (direct sound dominates) and the late pause (only the tail remains).
const inBurst = (t: number) => t % 0.6 > 0.05 && t % 0.6 < 0.22;
const inTail = (t: number) => t % 0.6 > 0.33 && t % 0.6 < 0.58;

/**
 * A voice-like signal with no room: two syllables a second, each a harmonic sound with a gliding
 * pitch near 115 Hz and two formants that rises in 20 ms, holds for 200 ms and fades over 100 ms.
 * A vowel that lasts and a word that fades are what a late-reverb estimate mistakes for echo (TME-279).
 */
const SYLLABLE = 0.5;
function voicedSyllables(seconds: number): Float64Array {
  const dry = new Float64Array(Math.round(seconds * RATE));
  let phase = 0;
  for (let i = 0; i < dry.length; i++) {
    const t = i / RATE;
    const u = t % SYLLABLE;
    const pitch = 115 + 12 * Math.sin(2 * Math.PI * 0.9 * t);
    phase += 2 * Math.PI * pitch / RATE;
    const envelope = u < 0.02 ? 0.5 - 0.5 * Math.cos(Math.PI * u / 0.02) : u < 0.22 ? 1 : u < 0.32 ? 0.5 + 0.5 * Math.cos(Math.PI * (u - 0.22) / 0.1) : 0;
    if (envelope === 0) continue;
    let sum = 0;
    for (let h = 1; h <= 30; h++) {
      const f = h * pitch;
      sum += (1 + 3 * Math.exp(-(((f - 700) / 250) ** 2)) + 2 * Math.exp(-(((f - 1800) / 400) ** 2))) / h * Math.sin(h * phase + h);
    }
    dry[i] = 0.08 * envelope * sum;
  }
  return dry;
}
// Parts of a syllable, by the time since it began, and the pause well after it.
const syllable = {
  onset: (u: number) => u < 0.03,
  vowel: (u: number) => u > 0.1 && u < 0.22,
  ending: (u: number) => u > 0.24 && u < 0.32,
  tail: (u: number) => u > 0.4 && u < 0.49
};

/**
 * Level change of the dry voice from `input` to `output` (which is late by `LATENCY`) over one part of
 * the syllables between `from` and `to` seconds: the ratio of their least-squares gains on the dry signal.
 */
function voiceLevel(output: Float64Array, input: Float64Array, dry: Float64Array, part: (u: number) => boolean, from: number, to = Infinity): number {
  const gain = (signal: Float64Array, delay: number) => {
    let cross = 0;
    let own = 0;
    for (let i = Math.round(from * RATE); i + delay < signal.length && i < to * RATE; i++) {
      if (!part(i / RATE % SYLLABLE)) continue;
      cross += signal[i + delay] * dry[i];
      own += dry[i] ** 2;
    }
    return cross / own;
  };
  return 2 * dB(gain(output, LATENCY), gain(input, 0));
}

describe('echo reduction DSP (WebAssembly)', () => {
  it('reports the latency the worklet compensates for', () => {
    assert.equal(instantiate(ECHO_PRESETS.light).LATENCY_FRAMES.value, LATENCY);
  });

  it('reconstructs the input exactly, delayed by its latency, when nothing is suppressed', () => {
    const dsp = instantiate({ rt60: 0.5, overSubtraction: 1, floorDb: 0, gap: 0.06 });
    const source = noise(7);
    const left = Float64Array.from({ length: 200 * QUANTUM }, () => 0.5 * source());
    const right = Float64Array.from({ length: 200 * QUANTUM }, () => 0.5 * source());
    const [outL, outR] = run(dsp, left, right);
    let worst = 0;
    for (let i = LATENCY + 1024; i < left.length; i++) {
      worst = Math.max(worst, Math.abs(outL[i] - left[i - LATENCY]), Math.abs(outR[i] - right[i - LATENCY]));
    }
    assert.ok(worst < 1e-5, `perfect reconstruction (worst error ${worst})`);
  });

  for (const [level, rate] of [['light', RATE], ['strong', RATE], ['light', 44100], ['strong', 44100]] as const) {
    it(`matches the float64 reference at ${level}, ${rate} Hz`, () => {
      const { left, right } = reverberantBursts(1, 0.8);
      const [wasmL, wasmR] = run(instantiate(ECHO_PRESETS[level], rate), left, right);
      const [refL, refR] = referenceEchoReduction(left, right, ECHO_PRESETS[level], rate);
      let error = 0;
      let signal = 0;
      for (let i = 0; i < left.length; i++) {
        error += (wasmL[i] - refL[i]) ** 2 + (wasmR[i] - refR[i]) ** 2;
        signal += refL[i] ** 2 + refR[i] ** 2;
      }
      const ratio = dB(error, signal);
      assert.ok(ratio < -90, `WASM deviates from the reference by ${ratio.toFixed(1)} dB`);
    });
  }

  it('shortens the room tail between words, Strong more than Light, and keeps most of the voice', () => {
    const { dry, left, right } = reverberantBursts(4, 0.8);
    const input = projection(left, dry, 0);
    const [light, strong] = (['light', 'strong'] as const).map(level => {
      const tailGains: Float32Array[] = [];
      const [outL] = run(instantiate(ECHO_PRESETS[level]), left, right, (gain, seconds) => {
        if (seconds > 1 && inTail(seconds - LATENCY / RATE)) tailGains.push(gain.slice());
      });
      return {
        tail: dB(energy(outL, LATENCY, inTail), energy(left, 0, inTail)),
        voice: 2 * dB(projection(outL, dry, LATENCY), input),
        ...restlessness(tailGains)
      };
    });
    // A steadier gain must not be bought with reverb reduction: these are the levels before it was smoothed.
    assert.ok(light.tail < -6.2, `Light lowers the tail (${light.tail.toFixed(1)} dB)`);
    assert.ok(strong.tail < -9.7, `Strong lowers it further (${strong.tail.toFixed(1)} dB)`);
    assert.ok(strong.tail < light.tail - 3, `by at least 3 dB (${(strong.tail - light.tail).toFixed(1)} dB)`);
    assert.ok(light.voice > -2, `Light keeps the voice (${light.voice.toFixed(1)} dB)`);
    assert.ok(strong.voice > -3.8, `Strong keeps most of the voice (${strong.voice.toFixed(1)} dB)`);
    for (const [name, level] of [['Light', light], ['Strong', strong]] as const) {
      assert.ok(level.across < 0.3, `${name} lowers the tail evenly across bins (${level.across.toFixed(2)} dB per bin)`);
      assert.equal(level.specks, 0, `${name} leaves no isolated bins open in the tail`);
    }
  });

  for (const level of ['light', 'strong'] as const) {
    // Steady sound is the hard case: nothing in it is an onset, yet every bin's power jitters from
    // frame to frame. A gain that follows the jitter turns it into musical noise (TME-275).
    it(`holds its gain steady on steady noise at ${level}`, () => {
      const [left, right] = [5, 6].map(seed => {
        const source = noise(seed);
        let low = 0;
        return Float64Array.from({ length: 3 * RATE }, () => {
          low += 0.2 * (source() - low);
          return 0.4 * low;
        });
      });
      const gains: Float32Array[] = [];
      run(instantiate(ECHO_PRESETS[level]), left, right, (gain, seconds) => {
        if (seconds > 1) gains.push(gain.slice());
      });
      const { across, along, specks } = restlessness(gains);
      assert.ok(across < 1.7, `neighbouring bins move together (${across.toFixed(2)} dB per bin)`);
      assert.ok(along < 1, `the gain drifts rather than flickers (${along.toFixed(2)} dB per frame)`);
      assert.ok(specks < 1.2, `almost no bin opens on its own (${specks.toFixed(2)} %)`);
    });
  }

  for (const level of ['light', 'strong'] as const) {
    // No room, so nothing to remove: any loss is the voice. Before TME-279 the vowel lost 2.6 dB (Light)
    // and 6.4 dB (Strong) after its onset and the fading end of the word 4.6 and 8.7 dB.
    it(`leaves a dry voice alone at ${level} once it has heard it stop`, () => {
      const dry = voicedSyllables(5);
      const [out] = run(instantiate(ECHO_PRESETS[level]), dry, dry);
      const [onset, vowel, ending] = [syllable.onset, syllable.vowel, syllable.ending].map(part => voiceLevel(out, dry, dry, part, 2.5));
      assert.ok(onset > -0.3, `the onset passes (${onset.toFixed(2)} dB)`);
      assert.ok(vowel > -0.3, `the vowel keeps its level and its harmonics (${vowel.toFixed(2)} dB)`);
      assert.ok(ending > -0.5, `the end of the word is not cut (${ending.toFixed(2)} dB)`);
      assert.ok(Math.max(onset, vowel, ending) - Math.min(onset, vowel, ending) < 0.4, 'the level does not move with the syllable');
    });
  }

  it('keeps the voice in a short room and still lowers the tail after each word', () => {
    const dry = voicedSyllables(5);
    const [left, right] = inRoom(dry, 0.3);
    const tails = (['light', 'strong'] as const).map(level => {
      const [out] = run(instantiate(ECHO_PRESETS[level]), left, right);
      const [onset, vowel, ending] = [syllable.onset, syllable.vowel, syllable.ending].map(part => voiceLevel(out, left, dry, part, 2.5));
      // Before TME-279: vowel -1.8 dB (Light) and -4.2 dB (Strong), ending -3.0 and -7.5 dB.
      assert.ok(onset > -0.3, `${level}: the onset passes (${onset.toFixed(2)} dB)`);
      assert.ok(vowel > -0.5, `${level}: the vowel keeps its level (${vowel.toFixed(2)} dB)`);
      assert.ok(ending > -0.6, `${level}: the end of the word is not cut (${ending.toFixed(2)} dB)`);
      const inPause = (t: number) => syllable.tail(t % SYLLABLE);
      return dB(energy(out, LATENCY, inPause, 2.5), energy(left, 0, inPause, 2.5));
    });
    // The useful part must stay: within about 1 dB of the tail reduction before TME-279 (-7.0 and -10.0 dB).
    assert.ok(tails[0] < -5.7, `Light lowers the tail (${tails[0].toFixed(1)} dB)`);
    assert.ok(tails[1] < -8.2, `Strong lowers it further (${tails[1].toFixed(1)} dB)`);
  });

  it('lowers the tail from 50 ms after each word in the TME-275 short room, at both levels', () => {
    // The 0.3 s room of TME-275: six reflections within 45 ms and a diffuse tail from 50 ms, 4 dB below the
    // direct sound. Before TME-279 the tail fell by the full floor (-7.0 and -10.0 dB) because everything
    // after an onset did. Keeping the word's ending costs about 1 dB of that; it must not cost more.
    const dry = voicedSyllables(6);
    const [left, right] = inShortRoom(dry);
    const afterWord = (t: number) => t % SYLLABLE > 0.37 && t % SYLLABLE < 0.49;
    const [light, strong] = (['light', 'strong'] as const).map(level => {
      const [out] = run(instantiate(ECHO_PRESETS[level]), left, right);
      const vowel = voiceLevel(out, left, dry, syllable.vowel, 3);
      assert.ok(vowel > -0.5, `${level}: the vowel keeps its level (${vowel.toFixed(2)} dB)`);
      return dB(energy(out, LATENCY, afterWord, 3), energy(left, 0, afterWord, 3));
    });
    assert.ok(light < -5.9, `Light lowers the tail (${light.toFixed(1)} dB)`);
    assert.ok(strong < -8.4, `Strong lowers it further (${strong.toFixed(1)} dB)`);
  });

  it('finds the echo again within two seconds when a dry scene cuts to an echoing one', () => {
    // A dry recording teaches it that nothing remains after a sound. A cut to a 0.8 s room contradicts
    // that with every decay, so the lesson must be dropped fast, not at the pace of ordinary drift.
    const dry = voicedSyllables(8);
    const [roomLeft, roomRight] = inRoom(dry, 0.8);
    const cut = 4 * RATE;
    const left = Float64Array.from(dry, (value, i) => i < cut ? value : roomLeft[i]);
    const right = Float64Array.from(dry, (value, i) => i < cut ? value : roomRight[i]);
    const inPause = (t: number) => syllable.tail(t % SYLLABLE);
    for (const level of ['light', 'strong'] as const) {
      const [afterCut] = run(instantiate(ECHO_PRESETS[level]), left, right);
      const [roomOnly] = run(instantiate(ECHO_PRESETS[level]), roomLeft, roomRight);
      const tail = (out: Float64Array) => dB(energy(out, LATENCY, inPause, 6), energy(roomLeft, 0, inPause, 6));
      assert.ok(tail(afterCut) < tail(roomOnly) + 1, `${level}: two seconds after the cut the tail is lowered as if it had only heard the room (${tail(afterCut).toFixed(1)} against ${tail(roomOnly).toFixed(1)} dB)`);
    }
  });

  it('keeps what it learned about the recording when the level changes, and forgets it on reset', () => {
    const dry = voicedSyllables(6);
    const switched = instantiate(ECHO_PRESETS.light);
    const [afterSwitch] = run(switched, dry, dry, undefined, seconds => {
      if (seconds === 3) configure(switched, ECHO_PRESETS.strong);
    });
    const vowelAfterSwitch = voiceLevel(afterSwitch, dry, dry, syllable.vowel, 3, 3.5);
    assert.ok(vowelAfterSwitch > -0.3, `the first vowel at Strong is untouched (${vowelAfterSwitch.toFixed(2)} dB)`);

    const restarted = instantiate(ECHO_PRESETS.strong);
    const [afterReset] = run(restarted, dry, dry, undefined, seconds => {
      if (seconds === 3) restarted.reset();
    });
    const vowelAfterReset = voiceLevel(afterReset, dry, dry, syllable.vowel, 3, 3.5);
    const vowelLater = voiceLevel(afterReset, dry, dry, syllable.vowel, 5, 6);
    assert.ok(vowelAfterReset < -3, `after a reset the preset's assumption applies again (${vowelAfterReset.toFixed(2)} dB)`);
    assert.ok(vowelLater > -0.3, `and the recording is learned again within two seconds (${vowelLater.toFixed(2)} dB)`);
  });

  it('recovers from a non-finite sample instead of carrying it in its history', () => {
    const dsp = instantiate(ECHO_PRESETS.strong);
    const { left, right } = reverberantBursts(1, 0.5);
    left[RATE / 4] = Number.NaN;
    const [outL, outR] = run(dsp, left, right);
    const later = [...outL.subarray(RATE / 2), ...outR.subarray(RATE / 2)];
    assert.ok(later.every(Number.isFinite), 'output is finite again after the bad frame');
    assert.ok(later.some(value => value !== 0), 'and carries audio');
  });

  it('recovers from samples far out of range without a non-finite gain staying in its memory', () => {
    // Finite but absurd samples after silence make the ratio of power to late estimate overflow. Written
    // as prior / (prior + 1) that is infinity over infinity, and the resulting NaN fed itself for good.
    const dsp = instantiate(ECHO_PRESETS.strong);
    const { left: bursts } = reverberantBursts(3, 0.5);
    const left = new Float64Array(bursts.length + RATE);
    for (let i = RATE / 2; i < RATE / 2 + 2048; i++) left[i] = 1e15 * (i % 2 ? 1 : -1);
    left.set(bursts, RATE);
    const [outL, outR] = run(dsp, left, left);
    const later = [...outL.subarray(RATE), ...outR.subarray(RATE)];
    assert.ok(later.every(Number.isFinite), 'output is finite again after the burst');
    assert.ok(outL.subarray(3 * RATE).some(value => Math.abs(value) > 1e-4), 'and carries audio');
  });

  it('treats low sound between words as before, not as a new source', () => {
    // A voice in the TME-275 short room with pauses of 0.7 s, and a rumble 50 dB below it. Once the echo has
    // faded, the rumble is all there is, and every swell of it stands above what a decay would leave. Taking
    // those swells for sources would raise the gain below 300 Hz in the pauses to -1 dB at both levels.
    const voice = voicedSyllables(8).map((value, i) => (i / RATE) % 1 < SYLLABLE ? value : 0);
    const [roomLeft, roomRight] = inShortRoom(voice);
    const next = noise(9);
    let low = 0;
    const rumble = Float64Array.from(voice, () => {
      low += 0.01 * (next() - low);
      return 0.3 * 10 ** (-50 / 20) * 12 * low;
    });
    const [left, right] = [roomLeft, roomRight].map(channel => channel.map((value, i) => value + rumble[i]));
    const [light, strong] = (['light', 'strong'] as const).map(level => {
      let sum = 0;
      let count = 0;
      run(instantiate(ECHO_PRESETS[level]), left, right, (gain, seconds) => {
        // The middle of a frame, from 330 ms after the word has ended.
        const u = (seconds - 512 / RATE) % 1;
        if (seconds < 3 || u < 0.65 || u > 0.97) return;
        for (let k = 1; k <= 4; k++) sum += gain[k] ** 2;
        count += 4;
      });
      return 10 * Math.log10(sum / count);
    });
    // Before TME-279: -4.1 and -7.0 dB.
    assert.ok(light < -3.6, `Light keeps the rumble down (${light.toFixed(1)} dB)`);
    assert.ok(strong < -6.5, `Strong too (${strong.toFixed(1)} dB)`);
  });

  it('hears a phrase 38 dB quieter than the one before it on its own terms', () => {
    // What counts as low sound is judged against the loudest the band has been. Held for long, that
    // judgement takes a quiet scene after a loud one for the pauses of the loud one: the voice lost what
    // it did before TME-279 (vowel -2.8 and -5.7 dB) for as long as the level stayed down.
    const dry = voicedSyllables(9);
    const input = Float64Array.from(dry, (value, i) => i < 4 * RATE ? value : value * 10 ** (-38 / 20));
    for (const level of ['light', 'strong'] as const) {
      const [out] = run(instantiate(ECHO_PRESETS[level]), input, input);
      const [vowel, ending] = [syllable.vowel, syllable.ending].map(part => voiceLevel(out, input, dry, part, 6, 8));
      assert.ok(vowel > -0.3, `${level}: two seconds on, the vowel keeps its level (${vowel.toFixed(2)} dB)`);
      assert.ok(ending > -0.5, `${level}: and the end of the word is not cut (${ending.toFixed(2)} dB)`);
    }
  });

  it('starts over silent after reset', () => {
    const dsp = instantiate(ECHO_PRESETS.light);
    const { left, right } = reverberantBursts(0.5, 0.5);
    run(dsp, left, right);
    dsp.reset();
    const [outL] = run(dsp, new Float64Array(LATENCY + QUANTUM), new Float64Array(LATENCY + QUANTUM));
    assert.ok(outL.every(value => value === 0), 'no earlier audio leaks out after a reset');
  });
});
