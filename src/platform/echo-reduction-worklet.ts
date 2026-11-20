/**
 * The AudioWorklet module behind echo reduction, built to `audio/echo-reduction.js` (a
 * web-accessible resource) and loaded by `createEchoLoader`. It stays self-contained: only types
 * are imported. The DSP arrives as bytes and is compiled here, because Chromium does not accept a
 * compiled `WebAssembly.Module` through a worklet port. A page CSP without 'wasm-unsafe-eval'
 * rejects the compile, and the reply tells MAIN to show the effect as unavailable.
 */
import { ECHO_PROCESSOR, type EchoCommand, type EchoReply } from './echo-reduction';

declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, processor: new () => AudioWorkletProcessor): void;

type Dsp = {
  memory: WebAssembly.Memory;
  configure(rt60: number, overSubtraction: number, floorDb: number, gap: number, rate: number): void;
  reset(): void;
  process(): void;
  inputBuffer(channel: number): number;
  outputBuffer(channel: number): number;
};

const QUANTUM = 128;

class EchoReductionProcessor extends AudioWorkletProcessor {
  private dsp: Dsp | null = null;
  private buffers: Float32Array[] = [];
  private configured = false;
  private idle = true;

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<EchoCommand>) => this.receive(event.data);
  }

  private receive(command: EchoCommand): void {
    if (command.type === 'load') {
      WebAssembly.instantiate(command.bytes, {}).then(({ instance }) => {
        const dsp = instance.exports as unknown as Dsp;
        // The stub runtime never grows memory, so these views stay valid.
        this.buffers = [dsp.inputBuffer(0), dsp.inputBuffer(1), dsp.outputBuffer(0), dsp.outputBuffer(1)]
          .map(pointer => new Float32Array(dsp.memory.buffer, pointer, QUANTUM));
        this.dsp = dsp;
        this.reply({ type: 'ready' });
      }, () => this.reply({ type: 'failed' }));
    } else if (command.type === 'configure') {
      this.dsp?.configure(command.rt60, command.overSubtraction, command.floorDb, command.gap, sampleRate);
      this.configured = this.dsp !== null;
    }
  }

  private reply(message: EchoReply): void {
    this.port.postMessage(message);
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const input = inputs[0];
    const output = outputs[0];
    // No input means the stage is off and disconnected; outputs stay silent.
    if (!input?.length || !output?.length) {
      this.idle = true;
      return true;
    }
    const dsp = this.dsp;
    if (!dsp || !this.configured || input[0].length !== QUANTUM) return true;
    // Coming back on must not replay the tail of audio from before it was turned off.
    if (this.idle) dsp.reset();
    this.idle = false;
    const [inL, inR, outL, outR] = this.buffers;
    inL.set(input[0]);
    inR.set(input[1] ?? input[0]);
    dsp.process();
    output[0].set(outL);
    output[1]?.set(outR);
    return true;
  }
}

registerProcessor(ECHO_PROCESSOR, EchoReductionProcessor);
