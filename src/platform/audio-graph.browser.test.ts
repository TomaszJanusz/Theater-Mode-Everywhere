import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
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
 * Renders a scene offline through the chain (or untouched when settings are
 * null) and returns single-bin DFT levels and RMS windows after the fades and
 * compressors settle. Scenes are generated in the page from a formula string.
 */
const RENDER = `(async ({ settings, channels, seconds, scene, bands, windows }) => {
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
  const from = rate;
  const signal = { mid: (i) => L[i] + R[i], side: (i) => L[i] - R[i] };
  const levels = {};
  for (const [name, [kind, frequency]] of Object.entries(bands)) {
    let re = 0, im = 0;
    for (let i = from; i < n; i++) {
      const phase = 2 * Math.PI * frequency * i / rate;
      re += signal[kind](i) * Math.cos(phase);
      im += signal[kind](i) * Math.sin(phase);
    }
    levels[name] = Math.hypot(re, im) / (n - from);
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

type RenderOptions = {
  channels?: number;
  seconds?: number;
  scene: string;
  bands?: Record<string, ['mid' | 'side', number]>;
  windows?: Record<string, [number, number]>;
};

const db = (value: number, reference: number) => 20 * Math.log10(value / reference);
const settings = (overrides: Partial<AudioSettings>): AudioSettings => ({ ...DEFAULT_AUDIO_SETTINGS, ...overrides });

// Speech and bass sit in the centre; a wide tone differs between channels.
const STEREO_SCENE = `0.08 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 4 * t)) * Math.sin(2 * Math.PI * 1500 * t)
  + 0.12 * Math.sin(2 * Math.PI * 80 * t) + (ch === 0 ? 1 : -1) * 0.1 * Math.sin(2 * Math.PI * 440 * t)`;
const STEREO_BANDS: RenderOptions['bands'] = { speech: ['mid', 1500], side: ['side', 440], bass: ['mid', 80] };

type Render = (s: AudioSettings | null, options: RenderOptions) => Promise<Record<string, number>>;

describe('audio graph', () => {
  let browser: Browser | null = null;
  let page: Page | null = null;
  before(async () => {
    const { chromium } = await import('playwright');
    if (!existsSync(chromium.executablePath())) return;
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
    await page.addScriptTag({ content: BUNDLE });
  });
  after(async () => { await browser?.close(); });

  async function withPage(run: (render: Render) => Promise<void>): Promise<void> {
    const current = page;
    if (!current) return;
    await run((s, options) => current.evaluate(`${RENDER}(${JSON.stringify({
      settings: s, channels: 2, seconds: 2, bands: {}, windows: {}, ...options
    })})`) as Promise<Record<string, number>>);
  }

  it('passes untouched audio through when every setting is neutral', async () => {
    await withPage(async (render) => {
      const scene = { scene: `0.9 * Math.sin(2 * Math.PI * 1000 * t)`, bands: { tone: ['mid', 1000] } } satisfies RenderOptions;
      const ref = await render(null, scene);
      const neutral = await render(DEFAULT_AUDIO_SETTINGS, scene);
      assert.ok(Math.abs(db(neutral.tone, ref.tone)) < 0.05, 'neutral settings add no gain, not even limiter makeup');
    });
  });

  it('lifts centred speech and lowers wide ambience in proportion to the voice level', async () => {
    await withPage(async (render) => {
      const options = { scene: STEREO_SCENE, bands: STEREO_BANDS };
      const ref = await render(null, options);
      const light = await render(settings({ voice: 'light' }), options);
      const strong = await render(settings({ voice: 'strong' }), options);
      const lightSpeech = db(light.speech, ref.speech);
      const strongSpeech = db(strong.speech, ref.speech);
      assert.ok(lightSpeech > 3, `light lifts speech (${lightSpeech.toFixed(1)} dB)`);
      assert.ok(strongSpeech > lightSpeech + 1, `strong lifts speech further (${strongSpeech.toFixed(1)} dB)`);
      assert.ok(db(light.side, ref.side) < 0, 'light lowers ambience');
      assert.ok(db(strong.side, ref.side) < db(light.side, ref.side) - 2, 'strong lowers ambience further');
      assert.ok(db(strong.bass, ref.bass) < 1, 'speech lift does not boost bass');

      // 5.1 dialogue lives in the centre channel, which a discrete stereo split would drop.
      const surround = { channels: 6, scene: `ch === 2 ? 0.08 * Math.sin(2 * Math.PI * 1500 * t) : 0`, bands: { speech: ['mid', 1500] } } satisfies RenderOptions;
      const surroundOff = await render(DEFAULT_AUDIO_SETTINGS, surround);
      const surroundStrong = await render(settings({ voice: 'strong' }), surround);
      assert.ok(db(surroundStrong.speech, surroundOff.speech) > 3, 'centre-channel speech is lifted');
    });
  });

  it('narrows the gap between quiet and loud passages, most at the strong level', async () => {
    await withPage(async (render) => {
      // Two seconds quiet, two seconds about 22 dB louder.
      const options = {
        seconds: 4,
        scene: `(t < 2 ? 0.016 : 0.2) * (Math.sin(2 * Math.PI * 440 * t) + 0.5 * Math.sin(2 * Math.PI * 1300 * t))`,
        windows: { quiet: [0.5, 2], loud: [2.5, 4] }
      } satisfies RenderOptions;
      const ref = await render(null, options);
      const light = await render(settings({ leveling: 'light' }), options);
      const strong = await render(settings({ leveling: 'strong' }), options);
      const range = (levels: Record<string, number>) => db(levels.loud, levels.quiet);
      assert.ok(range(light) < range(ref) - 4, `light narrows the range (${range(light).toFixed(1)} of ${range(ref).toFixed(1)} dB)`);
      assert.ok(range(strong) < range(light) - 6, `strong narrows it further (${range(strong).toFixed(1)} dB)`);
      assert.ok(db(light.quiet, ref.quiet) > 4, 'quiet passages become louder');
      assert.ok(Math.abs(db(light.loud, ref.loud)) < 1, 'light leaves loud passages at their level');
    });
  });

  it('shelves bass without touching the midrange', async () => {
    await withPage(async (render) => {
      const options = { scene: `0.1 * Math.sin(2 * Math.PI * 60 * t) + 0.1 * Math.sin(2 * Math.PI * 1000 * t)`, bands: { low: ['mid', 60], mid: ['mid', 1000] } } satisfies RenderOptions;
      const ref = await render(null, options);
      const less = await render(settings({ bass: 'less' }), options);
      const more = await render(settings({ bass: 'more' }), options);
      assert.ok(db(less.low, ref.low) < -4, 'less cuts bass');
      assert.ok(db(more.low, ref.low) > 4, 'more lifts bass');
      for (const levels of [less, more]) assert.ok(Math.abs(db(levels.mid, ref.mid)) < 0.5, 'midrange stays put');
    });
  });

  it('keeps hot mixes below full scale with every effect at its strongest', async () => {
    await withPage(async (render) => {
      const hot = await render(settings({ voice: 'strong', leveling: 'strong', bass: 'more' }), {
        scene: `2.2 * (${STEREO_SCENE})`
      });
      assert.ok(hot.peak <= 1, `peak ${hot.peak.toFixed(3)}`);
      const bass = await render(settings({ bass: 'more' }), { scene: `0.9 * Math.sin(2 * Math.PI * 60 * t)` });
      assert.ok(bass.peak <= 1, `bass peak ${bass.peak.toFixed(3)}`);
    });
  });
});
