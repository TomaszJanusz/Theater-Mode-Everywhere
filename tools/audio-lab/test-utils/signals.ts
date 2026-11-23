/** Deterministic signals with known timing for the metric tests. */
import type { Signal } from '../types';

export const RATE = 48000;

/** Deterministic noise in [-1, 1). */
export function noise(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 31 - 1;
  };
}

export const BURST = { period: 0.8, on: 0.3 };

/** Noise bursts, 300 ms on and 500 ms off, with nothing at all between them. */
export function bursts(seconds: number, seed = 1): Float32Array {
  const next = noise(seed);
  return Float32Array.from({ length: Math.round(seconds * RATE) }, (_, i) => {
    const phase = (i / RATE) % BURST.period;
    return phase < BURST.on ? 0.3 * next() * Math.min(1, phase / 0.005, (BURST.on - phase) / 0.005) : 0;
  });
}

/** Noise that starts with each burst and dies away through the pause after it (RT60 0.6 s). */
export function decays(seconds: number, seed = 2): Float32Array {
  const next = noise(seed);
  return Float32Array.from({ length: Math.round(seconds * RATE) }, (_, i) => {
    const phase = (i / RATE) % BURST.period;
    return 0.1 * next() * (phase < BURST.on ? 1 : Math.exp(-3 * Math.LN10 * (phase - BURST.on) / 0.6));
  });
}

export const stereo = (samples: Float32Array): Signal => ({ sampleRate: RATE, channels: [samples, samples.slice()] });

/** `samples` with a gain in dB that depends on the time within the burst period. */
export function shaped(samples: Float32Array, gainDb: (phase: number, seconds: number) => number): Float32Array {
  return samples.map((value, i) => value * 10 ** (gainDb((i / RATE) % BURST.period, i / RATE) / 20));
}

export function tone(hz: number, seconds: number, amplitude = 1, rate = RATE): Float32Array {
  return Float32Array.from({ length: Math.round(seconds * rate) }, (_, i) => amplitude * Math.sin(2 * Math.PI * hz * i / rate));
}
