/**
 * Runs the shipped echo-reduction binary offline, one 128-sample quantum per call as the worklet
 * drives it, and captures the gain it applied to each frame. The lab measures the binary that
 * ships; `echo-dsp.test.ts` ties it to the float64 reference and to the lab's own grid.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ECHO_DSP_BINARY } from '../../scripts/echo-dsp';
import type { EchoPreset } from '../../src/platform/echo-reduction-presets';

import { BINS, HOP } from './metrics/grid';
import type { Signal } from './types';

const ROOT = resolve(fileURLToPath(import.meta.url), '../../..');
const QUANTUM = 128;

type Dsp = {
  memory: WebAssembly.Memory;
  configure(rt60: number, overSubtraction: number, floorDb: number, gap: number, rate: number): void;
  process(): void;
  inputBuffer(channel: number): number;
  outputBuffer(channel: number): number;
  gainBuffer(): number;
  LATENCY_FRAMES: WebAssembly.Global;
};

let binary: WebAssembly.Module | null = null;

function instantiate(preset: EchoPreset, rate: number): Dsp {
  binary ??= new WebAssembly.Module(readFileSync(resolve(ROOT, ECHO_DSP_BINARY)));
  const dsp = new WebAssembly.Instance(binary, {}).exports as unknown as Dsp;
  dsp.configure(preset.rt60, preset.overSubtraction, preset.floorDb, preset.gap, rate);
  return dsp;
}

/**
 * `output` is aligned with `input` (the DSP's latency is fed through with silence and removed);
 * `gains[m]` is the gain of bins 0 to 512 for frame `m` of the grid in `metrics/grid.ts`.
 */
export function runEchoDsp(input: Signal, preset: EchoPreset): { output: Signal; gains: Float32Array[] } {
  const [left, right] = input.channels;
  if (!left || !right || input.channels.length !== 2) throw new Error('echo reduction takes a stereo signal');
  const dsp = instantiate(preset, input.sampleRate);
  const latency = dsp.LATENCY_FRAMES.value as number;
  const length = left.length;
  // Whole frames, and enough silence behind the signal for its last samples to leave the DSP.
  const total = Math.ceil((length + latency) / HOP) * HOP;
  const view = (pointer: number, size: number) => new Float32Array(dsp.memory.buffer, pointer, size);
  const [inL, inR, outL, outR] = [dsp.inputBuffer(0), dsp.inputBuffer(1), dsp.outputBuffer(0), dsp.outputBuffer(1)].map(pointer => view(pointer, QUANTUM));
  const gain = view(dsp.gainBuffer(), BINS);
  const out = [new Float32Array(total), new Float32Array(total)];
  const gains: Float32Array[] = [];
  for (let start = 0; start < total; start += QUANTUM) {
    inL.fill(0);
    inR.fill(0);
    if (start < length) {
      inL.set(left.subarray(start, Math.min(length, start + QUANTUM)));
      inR.set(right.subarray(start, Math.min(length, start + QUANTUM)));
    }
    dsp.process();
    out[0].set(outL, start);
    out[1].set(outR, start);
    // A frame is transformed on every second quantum; its gain stays readable until the next one.
    if ((start / QUANTUM) % 2 === 1) gains.push(gain.slice());
  }
  return {
    output: { sampleRate: input.sampleRate, channels: out.map(channel => channel.slice(latency, latency + length)) },
    gains
  };
}
