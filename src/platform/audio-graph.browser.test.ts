import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { Browser } from 'playwright';

import { BASS_MOAAARR_ENABLED, DEFAULT_AUDIO_SETTINGS, type AudioSettings } from '../audio-settings';
import {
  BASS_BANDS, BASS_SCENE, LEVELING_OPTIONS, STEREO_BANDS, STEREO_SCENE, db, openAudioRenderer, settings,
  type Render, type RenderOptions
} from '../test-utils/audio-render';

describe('audio graph', () => {
  let browser: Browser | null = null;
  let renderer: Render | null = null;
  before(async () => {
    const opened = await openAudioRenderer();
    browser = opened?.browser ?? null;
    renderer = opened?.render ?? null;
  });
  after(async () => { await browser?.close(); });

  async function withPage(run: (render: Render) => Promise<void>): Promise<void> {
    if (renderer) await run(renderer);
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
      const options = LEVELING_OPTIONS;
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
      const options = { scene: BASS_SCENE, bands: BASS_BANDS } satisfies RenderOptions;
      const ref = await render(null, options);
      const less = await render(settings({ bass: 'less' }), options);
      const more = await render(settings({ bass: 'more' }), options);
      const moar = await render(settings({ bass: 'moar' }), options);
      const moaaarr = BASS_MOAAARR_ENABLED ? await render(settings({ bass: 'moaaarr' }), options) : null;
      assert.ok(db(less.low, ref.low) < -4, 'less cuts bass');
      assert.ok(Math.abs(db(more.low, ref.low) - 6) < 1.5, `more lifts bass by about 6 dB (${db(more.low, ref.low).toFixed(1)})`);
      assert.ok(Math.abs(db(moar.low, ref.low) - 9) < 1.5, `moar lifts bass by about 9 dB (${db(moar.low, ref.low).toFixed(1)})`);
      if (moaaarr) assert.ok(Math.abs(db(moaaarr.low, ref.low) - 12) < 1.5, `moaaarr lifts bass by about 12 dB (${db(moaaarr.low, ref.low).toFixed(1)})`);
      for (const levels of [less, more, moar, ...(moaaarr ? [moaaarr] : [])]) assert.ok(Math.abs(db(levels.mid, ref.mid)) < 0.5, 'midrange stays put');
    });
  });

  it('keeps hot mixes below full scale with every effect at its strongest', async () => {
    await withPage(async (render) => {
      for (const bassLevel of (BASS_MOAAARR_ENABLED ? ['moar', 'moaaarr'] : ['moar']) as Array<AudioSettings['bass']>) {
        const hot = await render(settings({ voice: 'strong', leveling: 'strong', bass: bassLevel }), {
          scene: `2.2 * (${STEREO_SCENE})`
        });
        assert.ok(hot.peak <= 1, `${bassLevel} peak ${hot.peak.toFixed(3)}`);
        const bass = await render(settings({ bass: bassLevel }), { scene: `0.9 * Math.sin(2 * Math.PI * 60 * t)` });
        assert.ok(bass.peak <= 1, `${bassLevel} bass peak ${bass.peak.toFixed(3)}`);
        // Bass-heavy content with the other effects on: kick pulses under a tone.
        const heavy = await render(settings({ voice: 'light', leveling: 'light', bass: bassLevel }), {
          scene: `0.8 * Math.sin(2 * Math.PI * 55 * t) * Math.exp(-6 * ((t * 2) % 1)) + 0.12 * Math.sin(2 * Math.PI * 1500 * t)`
        });
        assert.ok(heavy.peak <= 1, `${bassLevel} bass-heavy peak ${heavy.peak.toFixed(3)}`);
      }
    });
  });

  it('only the top bass level keeps the soft ceiling in the signal path', { skip: !BASS_MOAAARR_ENABLED }, async () => {
    await withPage(async (render) => {
      // Below the knee the ceiling is transparent, and it is disconnected below MOAAARR! anyway.
      const options = { scene: `0.2 * Math.sin(2 * Math.PI * 1000 * t)`, bands: { tone: ['mid', 1000] } } satisfies RenderOptions;
      const moar = await render(settings({ bass: 'moar' }), options);
      const top = await render(settings({ bass: 'moaaarr' }), options);
      assert.ok(Math.abs(db(top.tone, moar.tone)) < 0.3, 'quiet material passes the ceiling unchanged');
    });
  });
});
