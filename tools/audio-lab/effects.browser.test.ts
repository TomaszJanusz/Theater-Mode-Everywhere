import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { Browser } from 'playwright';

import { openAudioRenderer } from '../../src/test-utils/audio-render';
import { skipUnlessEngine } from '../../src/test-utils/test-engines';

import { labEffects, latencyOf, type Effect } from './effects';
import { measure } from './measure';
import { syntheticMaterial } from './synthetic';
import type { Signal } from './types';

describe('audio lab: audio chain effects', { skip: skipUnlessEngine('chromium') }, () => {
  // The test owns the browser: a render that never returns ends with the test, not after it.
  let browser: Browser | null = null;
  let effects: Effect[] = [];
  before(async () => {
    const opened = await openAudioRenderer();
    if (!opened) return;
    browser = opened.browser;
    effects = labEffects(() => Promise.resolve({ evaluate: script => opened.page.evaluate(script), close: () => Promise.resolve() }));
  });
  after(async () => { await browser?.close(); });

  const material = syntheticMaterial('synthetic-dry', 3);
  const run = async (id: string, mix: Signal = material.mix) => {
    const effect = effects.find(candidate => candidate.id === id);
    assert.ok(effect);
    return effect.run(mix);
  };

  it('renders bass through the real chain: the shelf lifts the low band and leaves the midrange', async () => {
    if (!browser) return;
    const result = await run('bass-more');
    const rows = measure(material, result);
    const change = (id: string) => { const row = rows.find(candidate => candidate.id === id)!; return row.after - row.before; };
    assert.deepEqual(result.output.channels.map(channel => channel.length), material.mix.channels.map(channel => channel.length));
    assert.equal(result.follow, undefined, 'a Web Audio effect cannot be followed part by part');
    assert.ok(change('band-70-258') > 3 && change('band-70-258') < 8, `low band ${change('band-70-258').toFixed(2)} dB`);
    assert.ok(Math.abs(change('band-1008-1992')) < 1, `midrange ${change('band-1008-1992').toFixed(2)} dB`);
    assert.ok(rows.some(row => row.id === 'voice-level-mix') && rows.some(row => row.id === 'estoi-direct'), 'mix rows, and ESTOI against the known voice');
  });

  it('removes the latency of an effect that has one', async () => {
    if (!browser) return;
    const result = await run('leveling-strong');
    assert.equal(latencyOf(material.mix.channels, result.output.channels, 960), 0);
  });

  for (const id of ['bass-more', 'voice-strong', 'leveling-strong']) {
    it(`aligns ${id} on a clip with sound on the right only`, async () => {
      if (!browser) return;
      const click = new Float32Array(24000);
      click[10000] = 0.5;
      const { output } = await run(id, { sampleRate: 48000, channels: [new Float32Array(24000), click] });
      const right = output.channels[1];
      const peak = right.reduce((best, value, i) => (Math.abs(value) > Math.abs(right[best]) ? i : best), 0);
      assert.ok(Math.abs(peak - 10000) <= 2, `the click comes out at sample ${peak}`);
    });
  }
});
