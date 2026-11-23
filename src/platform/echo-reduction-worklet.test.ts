import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, describe, it } from 'node:test';

const RATE = 48000;
const QUANTUM = 128;
const WASM = readFileSync(new URL('../../assembly/echo-reduction.wasm', import.meta.url));

type Processor = {
  port: { onmessage: ((event: { data: unknown }) => void) | null };
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
};
/** What an AudioWorkletGlobalScope gives the module: the processor base, the registry, the rate and the clock. */
type Scope = {
  sampleRate: number;
  currentFrame: number;
  AudioWorkletProcessor: unknown;
  registerProcessor(name: string, processor: new () => Processor): void;
};
const scope = globalThis as unknown as Scope;

describe('echo reduction worklet', () => {
  let Registered: (new () => Processor) | undefined;
  let compiled: (ok: boolean) => void = () => {};

  before(async () => {
    scope.sampleRate = RATE;
    scope.currentFrame = 0;
    scope.AudioWorkletProcessor = class {
      port = { onmessage: null, postMessage: (ok: boolean) => compiled(ok) };
    };
    scope.registerProcessor = (_name, processor) => { Registered = processor; };
    await import('./echo-reduction-worklet');
  });

  /** A processor with the shipped DSP compiled and Strong chosen, and a way to render one quantum. */
  async function start() {
    assert.ok(Registered, 'the module registers its processor');
    const processor = new Registered();
    const ready = new Promise<boolean>(resolve => { compiled = resolve; });
    const bytes = WASM.buffer.slice(WASM.byteOffset, WASM.byteOffset + WASM.byteLength);
    processor.port.onmessage?.({ data: bytes });
    assert.equal(await ready, true, 'the DSP compiles');
    processor.port.onmessage?.({ data: 'strong' });
    let phase = 0;
    /** `connected: false` is how Firefox calls a disconnected node; Chromium does not call it at all. */
    const render = (amplitude: number, connected = true): Float32Array => {
      const input = Float32Array.from({ length: QUANTUM }, () => amplitude * Math.sin(phase += 2 * Math.PI * 440 / RATE));
      const output = [new Float32Array(QUANTUM), new Float32Array(QUANTUM)];
      processor.process(connected ? [[input, input]] : [[]], [output]);
      scope.currentFrame += QUANTUM;
      return output[0];
    };
    return { render };
  }
  const loudest = (quanta: Float32Array[]) => Math.max(...quanta.flatMap(quantum => Array.from(quantum, Math.abs)));

  it('renders the audio it is given, late by its latency', async () => {
    const { render } = await start();
    const out = Array.from({ length: 64 }, () => render(0.5));
    assert.ok(loudest(out.slice(16)) > 0.1, 'a tone comes out');
  });

  it('does not replay audio from before a pause in which it was not called', async () => {
    // Turning the effect off disconnects the node. Chromium then stops calling `process`, so the node
    // never sees an empty input; turned on again during silence it played what it still held from before.
    const { render } = await start();
    for (let i = 0; i < 64; i++) render(0.5);
    scope.currentFrame += RATE;
    const after = Array.from({ length: 16 }, () => render(0));
    assert.equal(loudest(after), 0, 'silence in, silence out');
  });

  it('does not replay audio from before a pause in which it was called without input', async () => {
    const { render } = await start();
    for (let i = 0; i < 64; i++) render(0.5);
    for (let i = 0; i < 8; i++) render(0, false);
    const after = Array.from({ length: 16 }, () => render(0));
    assert.equal(loudest(after), 0, 'silence in, silence out');
  });
});
