import type { AudioSettings } from '../audio-settings';
import type { AudioAssets } from '../protocol/audio-assets';

import { createAudioCrossfade } from './audio-crossfade';

/** Arguments of the DSP's `configure` (assembly/echo-reduction.ts); seconds and decibels. */
export type EchoPreset = { rt60: number; overSubtraction: number; floorDb: number; gap: number };

/**
 * One algorithm, two strengths (TME-259). Light is strength 1 of the spike's sweep. Strong is tuned to
 * the outcome the spike measured at strength 1.5 (about 3 dB less voice and 10 dB less tail in a
 * 0.8 s room) rather than to its parameters, because this gain rule is a little harsher. Stronger
 * settings cost far more voice for little extra intelligibility, and the residual turns watery.
 */
export const ECHO_PRESETS: Record<Exclude<AudioSettings['echo'], 'off'>, EchoPreset> = {
  light: { rt60: 0.5, overSubtraction: 1, floorDb: -8, gap: 0.06 },
  strong: { rt60: 0.65, overSubtraction: 1.15, floorDb: -11, gap: 0.055 }
};

export const ECHO_PROCESSOR = 'theater-echo-reduction';

/** MAIN to worklet. `load` carries the WebAssembly bytes, compiled in the worklet under the page's CSP. */
export type EchoCommand = { type: 'load'; bytes: ArrayBuffer } | ({ type: 'configure' } & EchoPreset);
/** Worklet to MAIN, once per `load`. */
export type EchoReply = { type: 'ready' | 'failed' };

/** Adds the worklet module to a context and resolves with the DSP bytes; rejects where that cannot work. */
export type EchoLoader = (ctx: BaseAudioContext) => Promise<ArrayBuffer>;

/**
 * Captures `fetch` and `addModule` at document_start, before page code could wrap them and read the
 * extension URLs, which in Firefox identify the profile. The bytes are fetched once per document.
 */
export function createEchoLoader(assets: () => AudioAssets | null): EchoLoader {
  const apply = Reflect.apply;
  const pageFetch = window.fetch;
  const addModule = typeof AudioWorklet === 'function' ? AudioWorklet.prototype.addModule : null;
  let bytes: Promise<ArrayBuffer> | null = null;
  return async ctx => {
    const urls = assets();
    // AudioWorklet exists only in secure contexts.
    if (!urls || !addModule || !ctx.audioWorklet) throw new Error('unavailable');
    bytes ??= (apply(pageFetch, window, [urls.wasm]) as Promise<Response>).then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.arrayBuffer();
    });
    await apply(addModule, ctx.audioWorklet, [urls.worklet]);
    // Each context compiles its own copy; the cached original stays intact.
    return (await bytes).slice(0);
  };
}

/**
 * The first stage of the chain. It stays bypassed until the worklet has compiled the DSP, so a
 * level chosen meanwhile starts with its fade-in once ready. A failure (a CSP without
 * 'wasm-unsafe-eval', no AudioWorklet, a revoked extension URL) reports `onUnavailable` and leaves
 * the stage dry for good. While off, the worklet node is disconnected and returns at once.
 */
export function echoStage(ctx: BaseAudioContext, load: EchoLoader | undefined, onUnavailable: () => void) {
  const entry = ctx.createGain();
  const exit = ctx.createGain();
  const fade = createAudioCrossfade(ctx, { input: entry, output: exit });
  let state: 'idle' | 'loading' | 'ready' | 'failed' = 'idle';
  let level: AudioSettings['echo'] = 'off';
  let node: AudioWorkletNode | null = null;
  let disposed = false;

  const release = () => {
    node?.port.close();
    node?.disconnect();
    node = null;
  };
  const fail = () => {
    if (disposed || state === 'failed') return;
    state = 'failed';
    release();
    onUnavailable();
  };
  const sync = () => {
    if (state !== 'ready' || !node) return;
    if (level !== 'off') node.port.postMessage({ type: 'configure', ...ECHO_PRESETS[level] } satisfies EchoCommand);
    fade.setActive(level !== 'off');
  };
  const start = (loader: EchoLoader) => {
    state = 'loading';
    loader(ctx).then(bytes => {
      if (disposed) return;
      // Two channels in and out. Like the voice stage, a 5.1 source is downmixed with its centre channel kept.
      const worklet = new AudioWorkletNode(ctx, ECHO_PROCESSOR, {
        outputChannelCount: [2], channelCountMode: 'explicit', channelInterpretation: 'speakers'
      });
      node = worklet;
      worklet.onprocessorerror = fail;
      worklet.port.onmessage = (event: MessageEvent<EchoReply>) => {
        if (disposed || node !== worklet) return;
        if (event.data?.type !== 'ready') return fail();
        state = 'ready';
        entry.connect(worklet).connect(exit);
        sync();
      };
      worklet.port.postMessage({ type: 'load', bytes } satisfies EchoCommand, [bytes]);
    }).catch(fail);
  };

  return {
    input: fade.input,
    output: fade.output,
    set(next: AudioSettings['echo']) {
      level = next;
      if (next === 'off' || state !== 'idle') return sync();
      if (load) start(load);
      else fail();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      fade.dispose();
      release();
      entry.disconnect();
      exit.disconnect();
    }
  };
}
