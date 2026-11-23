/**
 * The effects the lab can run. Echo reduction runs the shipped WebAssembly in node. The effects of
 * the Web Audio chain (voice, bass, leveling) exist only as browser nodes, so they render offline
 * in Chromium through the real `createAudioChain`, as `pnpm audio:charts` does.
 */
import { BASS_LEVELS, DEFAULT_AUDIO_SETTINGS, ECHO_LEVELS, LEVELING_LEVELS, VOICE_LEVELS, type AudioSettings } from '../../src/audio-settings';
import { ECHO_PRESETS } from '../../src/platform/echo-reduction-presets';

import { runEchoDsp } from './echo-dsp';
import { applyGains } from './metrics/grid';
import type { Signal } from './types';

export type EffectResult = {
  /** Aligned with the input: same length, the effect's latency removed. */
  output: Signal;
  /**
   * Renders another signal with the gains the effect chose for the mix. Present only where that is
   * exact (an effect that is linear in its input once its gain is known); it lets the lab follow
   * the voice and the reverb through the effect separately.
   */
  follow?: (part: Signal) => Signal;
};
export type Effect = { id: string; label: string; run(mix: Signal): Promise<EffectResult> };

const echo = (level: Exclude<AudioSettings['echo'], 'off'>): Effect => ({
  id: `echo-${level}`,
  label: `Echo reduction, ${level}`,
  run: mix => {
    const { output, gains } = runEchoDsp(mix, ECHO_PRESETS[level]);
    return Promise.resolve({ output, follow: part => applyGains(part, gains) });
  }
});

/** Silence before the clip for the chain's switch-on fades, and after it for the latency search. */
const LEAD_SECONDS = 1;
const MAX_LATENCY_SECONDS = 0.02;

/** Runs in the page: decodes base64 float32 channels, renders them through the chain, encodes the result. */
const RENDER = `(async ({ settings, sampleRate, channels, lead, tail }) => {
  const decode = async (text) => new Float32Array(await (await fetch('data:application/octet-stream;base64,' + text)).arrayBuffer());
  const data = await Promise.all(channels.map(decode));
  const length = lead + data[0].length + tail;
  const ctx = new OfflineAudioContext(2, length, sampleRate);
  const buffer = ctx.createBuffer(2, length, sampleRate);
  data.forEach((channel, index) => buffer.getChannelData(index).set(channel, lead));
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const chain = AudioGraph.createAudioChain(ctx);
  source.connect(chain.input);
  chain.output.connect(ctx.destination);
  chain.apply(settings);
  source.start();
  const rendered = await ctx.startRendering();
  return [0, 1].map((index) => {
    const bytes = new Uint8Array(rendered.getChannelData(index).buffer);
    let text = '';
    for (let i = 0; i < bytes.length; i += 32768) text += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
    return btoa(text);
  });
})`;

const toBase64 = (samples: Float32Array) => Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength).toString('base64');
function fromBase64(text: string): Float32Array {
  const bytes = Buffer.from(text, 'base64');
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

/** The delay of `output` against `input` (0 to `limit` samples) at which they correlate best. */
export function latencyOf(input: Float32Array, output: Float32Array, limit: number): number {
  let best = 0;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let lag = 0; lag <= limit; lag++) {
    let score = 0;
    for (let i = 0; i < input.length && i + lag < output.length; i++) score += input[i] * output[i + lag];
    if (score > bestScore) { bestScore = score; best = lag; }
  }
  return best;
}

const graph = (name: 'voice' | 'bass' | 'leveling', level: string): Effect => ({
  id: `${name}-${level}`,
  label: `${name[0].toUpperCase()}${name.slice(1)}, ${level}`,
  run: async mix => {
    // Loaded on demand: the module bundles the audio graph for the page when it is imported.
    const { openAudioRenderer } = await import('../../src/test-utils/audio-render');
    const renderer = await openAudioRenderer();
    if (!renderer) throw new Error(`${name}-${level} renders in Chromium; run \`pnpm exec playwright install chromium\`.`);
    try {
      const lead = Math.round(LEAD_SECONDS * mix.sampleRate);
      const tail = Math.round(MAX_LATENCY_SECONDS * mix.sampleRate);
      const settings: AudioSettings = { ...DEFAULT_AUDIO_SETTINGS, [name]: level };
      const request = JSON.stringify({ settings, sampleRate: mix.sampleRate, channels: mix.channels.map(toBase64), lead, tail });
      const rendered = (await renderer.page.evaluate(`${RENDER}(${request})`) as string[]).map(fromBase64);
      const length = mix.channels[0].length;
      const latency = latencyOf(mix.channels[0], rendered[0].subarray(lead), tail);
      return { output: { sampleRate: mix.sampleRate, channels: rendered.map(channel => channel.slice(lead + latency, lead + latency + length)) } };
    } finally {
      await renderer.browser.close();
    }
  }
});

export const LAB_EFFECTS: Effect[] = [
  ...ECHO_LEVELS.filter(level => level !== 'off').map(echo),
  ...VOICE_LEVELS.filter(level => level !== 'off').map(level => graph('voice', level)),
  ...BASS_LEVELS.filter(level => level !== 'original').map(level => graph('bass', level)),
  ...LEVELING_LEVELS.filter(level => level !== 'off').map(level => graph('leveling', level))
];
