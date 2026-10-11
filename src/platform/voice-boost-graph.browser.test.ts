import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const esbuild = require(createRequire(require.resolve('vite')).resolve('esbuild')) as {
  buildSync(options: Record<string, unknown>): { outputFiles: Array<{ text: string }> };
};
const BUNDLE = esbuild.buildSync({
  entryPoints: [path.join(SRC, 'platform/voice-boost-graph.ts')],
  bundle: true, write: false, format: 'iife', globalName: 'VoiceBoostGraph', platform: 'browser', target: 'es2022'
}).outputFiles[0].text;

type Bands = { speech: number; side: number; bass: number; peak: number };
type Levels = Record<'reference' | 'off' | 'light' | 'strong', Bands>;

/**
 * Renders a synthetic mix offline: speech in the centre, bass in the centre,
 * and wide ambience that differs between channels. Band levels come from a
 * single-bin DFT after the fade and compressor settle.
 */
const MEASURE = `(async ({ gain, surround }) => {
  const rate = 48000, n = rate * 2, from = rate;
  const scene = (ctx) => {
    const buffer = ctx.createBuffer(surround ? 6 : 2, n, rate);
    const L = buffer.getChannelData(0), R = buffer.getChannelData(1);
    const C = surround ? buffer.getChannelData(2) : null;
    for (let i = 0; i < n; i++) {
      const t = i / rate;
      const speech = 0.08 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 4 * t)) * Math.sin(2 * Math.PI * 1500 * t);
      const bass = 0.12 * Math.sin(2 * Math.PI * 80 * t);
      const wide = 0.1 * Math.sin(2 * Math.PI * 440 * t);
      if (C) C[i] = speech;
      L[i] = gain * ((C ? 0 : speech) + bass + wide);
      R[i] = gain * ((C ? 0 : speech) + bass - wide);
      if (C) C[i] *= gain;
    }
    return buffer;
  };
  const render = async (level) => {
    const ctx = new OfflineAudioContext(2, n, rate);
    const source = ctx.createBufferSource();
    source.buffer = scene(ctx);
    if (level === 'reference') {
      source.connect(ctx.destination);
    } else {
      const chain = VoiceBoostGraph.createVoiceBoostChain(ctx);
      source.connect(chain.input);
      chain.output.connect(ctx.destination);
      chain.setLevel(level);
    }
    source.start();
    const out = await ctx.startRendering();
    const L = out.getChannelData(0), R = out.getChannelData(1);
    const band = (signal, frequency) => {
      let re = 0, im = 0;
      for (let i = from; i < n; i++) {
        const phase = 2 * Math.PI * frequency * i / rate;
        re += signal(i) * Math.cos(phase);
        im += signal(i) * Math.sin(phase);
      }
      return Math.hypot(re, im) / (n - from);
    };
    let peak = 0;
    for (let i = from; i < n; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
    return {
      speech: band((i) => L[i] + R[i], 1500),
      side: band((i) => L[i] - R[i], 440),
      bass: band((i) => L[i] + R[i], 80),
      peak
    };
  };
  const result = {};
  for (const level of ['reference', 'off', 'light', 'strong']) result[level] = await render(level);
  return result;
})`;

const db = (value: number, reference: number) => 20 * Math.log10(value / reference);

describe('voice boost graph', () => {
  it('lifts centred speech and lowers wide ambience in proportion to the level', async () => {
    const { chromium } = await import('playwright');
    if (!existsSync(chromium.executablePath())) return;
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.addScriptTag({ content: BUNDLE });
      const measure = (options: { gain: number; surround: boolean }) =>
        page.evaluate(`${MEASURE}(${JSON.stringify(options)})`) as Promise<Levels>;

      const stereo = await measure({ gain: 1, surround: false });
      const ref = stereo.reference;
      assert.ok(Math.abs(db(stereo.off.speech, ref.speech)) < 0.2, 'off leaves speech untouched');
      assert.ok(Math.abs(db(stereo.off.side, ref.side)) < 0.2, 'off leaves ambience untouched');

      const lightSpeech = db(stereo.light.speech, ref.speech);
      const strongSpeech = db(stereo.strong.speech, ref.speech);
      assert.ok(lightSpeech > 3, `light lifts speech (${lightSpeech.toFixed(1)} dB)`);
      assert.ok(strongSpeech > lightSpeech + 1, `strong lifts speech further (${strongSpeech.toFixed(1)} dB)`);
      assert.ok(db(stereo.light.side, ref.side) < 0, 'light lowers ambience');
      assert.ok(db(stereo.strong.side, ref.side) < db(stereo.light.side, ref.side) - 2, 'strong lowers ambience further');
      assert.ok(db(stereo.strong.bass, ref.bass) < 1, 'speech lift does not boost bass');

      // 5.1 dialogue lives in the centre channel, which a discrete stereo split would drop.
      const surround = await measure({ gain: 1, surround: true });
      assert.ok(db(surround.strong.speech, surround.off.speech) > 3, 'centre-channel speech is lifted');

      const hot = await measure({ gain: 2.2, surround: false });
      for (const level of ['light', 'strong'] as const) {
        assert.ok(hot[level].peak <= 1, `${level} keeps a hot mix below full scale (${hot[level].peak.toFixed(3)})`);
      }
    } finally {
      await browser.close();
    }
  });
});
