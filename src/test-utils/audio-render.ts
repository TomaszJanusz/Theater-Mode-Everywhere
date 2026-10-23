import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Browser, Page } from 'playwright';

import { DEFAULT_AUDIO_SETTINGS, type AudioSettings } from '../audio-settings';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const esbuild = require(createRequire(require.resolve('vite')).resolve('esbuild')) as {
  buildSync(options: Record<string, unknown>): { outputFiles: Array<{ text: string }> };
};
const BUNDLE = esbuild.buildSync({
  entryPoints: [path.join(SRC, 'platform/audio-graph.ts')],
  bundle: true, write: false, format: 'iife', globalName: 'AudioGraph', platform: 'browser', target: 'es2022'
}).outputFiles[0].text;

/**
 * Renders a scene offline through the real audio chain (or untouched when settings are
 * null) and returns single-bin DFT levels and RMS windows after the fades and
 * compressors settle. Scenes are generated in the page from a formula string.
 * `range` limits the DFT to a span of seconds (default: from one second to the end).
 */
const RENDER = `(async ({ settings, channels, seconds, scene, bands, windows, range }) => {
  const rate = 48000, n = rate * seconds;
  const fill = new Function('t', 'ch', 'return ' + scene);
  const ctx = new OfflineAudioContext(2, n, rate);
  const buffer = ctx.createBuffer(channels, n, rate);
  for (let ch = 0; ch < channels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < n; i++) data[i] = fill(i / rate, ch);
  }
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  if (settings) {
    const chain = AudioGraph.createAudioChain(ctx);
    source.connect(chain.input);
    chain.output.connect(ctx.destination);
    chain.apply(settings);
  } else {
    source.connect(ctx.destination);
  }
  source.start();
  const out = await ctx.startRendering();
  const L = out.getChannelData(0), R = out.getChannelData(1);
  const from = (range ? range[0] : 1) * rate, to = (range ? range[1] : seconds) * rate;
  const signal = { mid: (i) => L[i] + R[i], side: (i) => L[i] - R[i] };
  const levels = {};
  for (const [name, [kind, frequency]] of Object.entries(bands)) {
    let re = 0, im = 0;
    for (let i = from; i < to; i++) {
      const phase = 2 * Math.PI * frequency * i / rate;
      re += signal[kind](i) * Math.cos(phase);
      im += signal[kind](i) * Math.sin(phase);
    }
    levels[name] = Math.hypot(re, im) / (to - from);
  }
  for (const [name, [start, end]] of Object.entries(windows)) {
    let sum = 0;
    for (let i = start * rate; i < end * rate; i++) sum += L[i] * L[i];
    levels[name] = Math.sqrt(sum / ((end - start) * rate));
  }
  let peak = 0;
  for (let i = from; i < n; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  levels.peak = peak;
  return levels;
})`;

export type RenderOptions = {
  channels?: number;
  seconds?: number;
  scene: string;
  bands?: Record<string, ['mid' | 'side', number]>;
  windows?: Record<string, [number, number]>;
  range?: [number, number];
};
export type Render = (settings: AudioSettings | null, options: RenderOptions) => Promise<Record<string, number>>;

export const db = (value: number, reference: number) => 20 * Math.log10(value / reference);
export const settings = (overrides: Partial<AudioSettings>): AudioSettings => ({ ...DEFAULT_AUDIO_SETTINGS, ...overrides });

// Speech and bass sit in the centre; a wide tone differs between channels.
export const STEREO_SCENE = `0.08 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 4 * t)) * Math.sin(2 * Math.PI * 1500 * t)
  + 0.12 * Math.sin(2 * Math.PI * 80 * t) + (ch === 0 ? 1 : -1) * 0.1 * Math.sin(2 * Math.PI * 440 * t)`;
export const STEREO_BANDS: RenderOptions['bands'] = { speech: ['mid', 1500], side: ['side', 440], bass: ['mid', 80] };
export const BASS_SCENE = `0.1 * Math.sin(2 * Math.PI * 60 * t) + 0.1 * Math.sin(2 * Math.PI * 1000 * t)`;
export const BASS_BANDS: RenderOptions['bands'] = { low: ['mid', 60], mid: ['mid', 1000] };
// Two seconds quiet, two seconds about 22 dB louder.
export const LEVELING_SCENE = `(t < 2 ? 0.016 : 0.2) * (Math.sin(2 * Math.PI * 440 * t) + 0.5 * Math.sin(2 * Math.PI * 1300 * t))`;
export const LEVELING_OPTIONS = { seconds: 4, scene: LEVELING_SCENE, windows: { quiet: [0.5, 2], loud: [2.5, 4] } } satisfies RenderOptions;

/** Opens Chromium with the audio chain bundle loaded; null when no Chromium build is installed. */
export async function openAudioRenderer(): Promise<{ browser: Browser; page: Page; render: Render } | null> {
  const { chromium } = await import('playwright');
  if (!existsSync(chromium.executablePath())) return null;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.addScriptTag({ content: BUNDLE });
  const render: Render = (s, options) => page.evaluate(`${RENDER}(${JSON.stringify({
    settings: s, channels: 2, seconds: 2, bands: {}, windows: {}, range: null, ...options
  })})`) as Promise<Record<string, number>>;
  return { browser, page, render };
}
