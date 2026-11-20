import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { referenceEchoReduction } from '../test-utils/echo-reduction-reference';

import { ECHO_PRESETS, type EchoPreset } from './echo-reduction';

const RATE = 48000;
const QUANTUM = 128;
const LATENCY = 896;
// The shipped binary, not a fresh build: verify:bundles proves it matches its source.
const BINARY = readFileSync(new URL('../../assembly/echo-reduction.wasm', import.meta.url));

type Dsp = {
  memory: WebAssembly.Memory;
  configure(rt60: number, overSubtraction: number, floorDb: number, gap: number, rate: number): void;
  reset(): void;
  process(): void;
  inputBuffer(channel: number): number;
  outputBuffer(channel: number): number;
  LATENCY_FRAMES: WebAssembly.Global;
};

function instantiate(preset: EchoPreset): Dsp {
  const { exports } = new WebAssembly.Instance(new WebAssembly.Module(BINARY), {});
  const dsp = exports as unknown as Dsp;
  dsp.configure(preset.rt60, preset.overSubtraction, preset.floorDb, preset.gap, RATE);
  return dsp;
}

function run(dsp: Dsp, left: Float64Array, right: Float64Array): [Float64Array, Float64Array] {
  const view = (pointer: number) => new Float32Array(dsp.memory.buffer, pointer, QUANTUM);
  const [inL, inR, outL, outR] = [dsp.inputBuffer(0), dsp.inputBuffer(1), dsp.outputBuffer(0), dsp.outputBuffer(1)].map(view);
  const out: [Float64Array, Float64Array] = [new Float64Array(left.length), new Float64Array(left.length)];
  for (let start = 0; start + QUANTUM <= left.length; start += QUANTUM) {
    inL.set(left.subarray(start, start + QUANTUM));
    inR.set(right.subarray(start, start + QUANTUM));
    dsp.process();
    out[0].set(outL, start);
    out[1].set(outR, start);
  }
  return out;
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
 * Speech-like bursts (noise with a falling spectrum, 250 ms on, 350 ms off) in a room: the dry
 * signal plus an exponentially decaying noise tail with RT60 `rt60`, different per channel like a
 * real room. Noise keeps the tail uncorrelated with the dry voice, so a projection measures what is left of it.
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
  const length = Math.round(rt60 * RATE);
  const channels = [noise(1), noise(2)].map(next => {
    const impulse = new Float64Array(length);
    const k = 3 * Math.LN10 / rt60;
    // Early reflections arrive with the direct sound; the diffuse tail starts after 5 ms.
    for (let i = Math.round(0.005 * RATE); i < length; i++) impulse[i] = 0.12 * next() * Math.exp(-k * i / RATE);
    const wet = new Float64Array(n);
    // A sparse convolution keeps the test fast; every 32nd tap still makes a dense, decaying tail.
    for (let tap = 0; tap < length; tap += 32) {
      const h = impulse[tap] * Math.sqrt(32);
      if (h === 0) continue;
      for (let i = tap; i < n; i++) wet[i] += h * dry[i - tap];
    }
    return wet.map((value, i) => value + dry[i]);
  });
  return { dry, left: channels[0], right: channels[1] };
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

  for (const level of ['light', 'strong'] as const) {
    it(`matches the float64 reference at ${level}`, () => {
      const { left, right } = reverberantBursts(1, 0.8);
      const [wasmL, wasmR] = run(instantiate(ECHO_PRESETS[level]), left, right);
      const [refL, refR] = referenceEchoReduction(left, right, ECHO_PRESETS[level], RATE);
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
      const [outL] = run(instantiate(ECHO_PRESETS[level]), left, right);
      return {
        tail: dB(energy(outL, LATENCY, inTail), energy(left, 0, inTail)),
        voice: 2 * dB(projection(outL, dry, LATENCY), input)
      };
    });
    assert.ok(light.tail < -4, `Light lowers the tail (${light.tail.toFixed(1)} dB)`);
    assert.ok(strong.tail < light.tail - 3, `Strong lowers it further (${strong.tail.toFixed(1)} dB)`);
    assert.ok(light.voice > -2.5, `Light keeps the voice (${light.voice.toFixed(1)} dB)`);
    assert.ok(strong.voice > -4.5, `Strong keeps most of the voice (${strong.voice.toFixed(1)} dB)`);
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

  it('starts over silent after reset', () => {
    const dsp = instantiate(ECHO_PRESETS.light);
    const { left, right } = reverberantBursts(0.5, 0.5);
    run(dsp, left, right);
    dsp.reset();
    const [outL] = run(dsp, new Float64Array(LATENCY + QUANTUM), new Float64Array(LATENCY + QUANTUM));
    assert.ok(outL.every(value => value === 0), 'no earlier audio leaks out after a reset');
  });
});
