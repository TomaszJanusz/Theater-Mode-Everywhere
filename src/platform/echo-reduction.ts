import type { AudioSettings } from '../audio-settings';
import { echoWasmUrl } from '../protocol/audio-assets';

import { createAudioCrossfade } from './audio-crossfade';
import type { EchoLevel } from './echo-reduction-presets';

export const ECHO_PROCESSOR = 'theater-echo-reduction';

/**
 * MAIN to worklet: the WebAssembly bytes once (compiled there, under the page's CSP), then levels.
 * The worklet answers the bytes once with a boolean: whether the DSP compiled.
 */
export type EchoCommand = ArrayBuffer | EchoLevel;

/** Adds the worklet module to a context and resolves with the DSP bytes; rejects where that cannot work. */
export type EchoLoader = (ctx: BaseAudioContext) => Promise<ArrayBuffer>;
/** How the stage loads its worklet, and whom it tells when it cannot run on this page. */
export type EchoSupport = { load: EchoLoader; onUnavailable(): void };

/**
 * Captures `fetch` and `addModule` at document_start, before page code could wrap them and read the
 * extension URLs, which in Firefox identify the profile. The bytes are fetched once per document.
 */
export function createEchoLoader(workletUrl: () => string | null): EchoLoader {
  const apply = Reflect.apply;
  const pageFetch = window.fetch;
  // AudioWorklet exists only in secure contexts.
  const addModule = window.AudioWorklet && AudioWorklet.prototype.addModule;
  let bytes: Promise<ArrayBuffer> | undefined;
  return async ctx => {
    const url = workletUrl();
    if (!url || !addModule) throw new Error('unavailable');
    bytes ??= (apply(pageFetch, window, [echoWasmUrl(url)]) as Promise<Response>).then(response => response.arrayBuffer());
    await apply(addModule, ctx.audioWorklet, [url]);
    // Each context compiles its own copy; the cached original stays intact.
    return (await bytes).slice(0);
  };
}

/**
 * The first stage of the chain. It stays dry until the worklet has compiled the DSP, so a level chosen
 * meanwhile starts with its fade-in once ready. A failure (a CSP without 'wasm-unsafe-eval', no
 * AudioWorklet, a revoked extension URL) reports `onUnavailable` and leaves the stage dry for good.
 * While off, the worklet node is disconnected and returns at once.
 */
export function echoStage(ctx: BaseAudioContext, support: EchoSupport | undefined) {
  const entry = ctx.createGain();
  const exit = ctx.createGain();
  const fade = createAudioCrossfade(ctx, { input: entry, output: exit });
  let level: AudioSettings['echo'] = 'off';
  let node: AudioWorkletNode | undefined;
  let started = false;
  let ready = false;
  // Disposed or failed: no continuation may connect or report any more.
  let done = false;

  const stop = () => {
    done = true;
    if (node) {
      node.port.close();
      node.disconnect();
    }
  };
  const fail = () => {
    if (done) return;
    stop();
    if (support) support.onUnavailable();
  };
  const sync = () => {
    if (!ready || done || !node) return;
    if (level !== 'off') node.port.postMessage(level satisfies EchoCommand);
    fade.setActive(level !== 'off');
  };
  const start = (load: EchoLoader) => load(ctx).then(bytes => {
    if (done) return;
    // Two channels in and out: like the voice stage, a 5.1 source is downmixed with its centre kept.
    const worklet = node = new AudioWorkletNode(ctx, ECHO_PROCESSOR, { outputChannelCount: [2], channelCountMode: 'explicit' });
    worklet.onprocessorerror = fail;
    worklet.port.onmessage = (event: MessageEvent<boolean>) => {
      if (done || ready) return;
      if (!event.data) return fail();
      ready = true;
      entry.connect(worklet).connect(exit);
      sync();
    };
    worklet.port.postMessage(bytes satisfies EchoCommand, [bytes]);
  }, fail);

  return {
    input: fade.input,
    output: fade.output,
    set(next: AudioSettings['echo']) {
      level = next;
      if (next !== 'off' && !started) {
        started = true;
        if (support) void start(support.load);
        else fail();
      }
      sync();
    },
    // Safe to repeat, and after a failure.
    dispose() {
      stop();
      fade.dispose();
      entry.disconnect();
      exit.disconnect();
    }
  };
}
