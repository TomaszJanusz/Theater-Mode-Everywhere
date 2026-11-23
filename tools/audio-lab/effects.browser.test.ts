import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { skipUnlessEngine } from '../../src/test-utils/test-engines';

import { LAB_EFFECTS, latencyOf } from './effects';
import { measure } from './measure';
import { syntheticMaterial } from './synthetic';

describe('audio lab: audio chain effects', { skip: skipUnlessEngine('chromium') }, () => {
  const material = syntheticMaterial('synthetic-dry', 3);
  const run = async (id: string) => {
    const effect = LAB_EFFECTS.find(candidate => candidate.id === id);
    assert.ok(effect);
    const result = await effect.run(material.mix);
    const rows = measure(material, result);
    return { result, change: (rowId: string) => { const row = rows.find(candidate => candidate.id === rowId)!; return row.after - row.before; }, rows };
  };

  it('renders bass through the real chain: the shelf lifts the low band and leaves the midrange', async () => {
    const { result, change, rows } = await run('bass-more');
    assert.deepEqual(result.output.channels.map(channel => channel.length), material.mix.channels.map(channel => channel.length));
    assert.equal(result.follow, undefined, 'a Web Audio effect cannot be followed part by part');
    assert.ok(change('band-70-258') > 3 && change('band-70-258') < 8, `low band ${change('band-70-258').toFixed(2)} dB`);
    assert.ok(Math.abs(change('band-1008-1992')) < 1, `midrange ${change('band-1008-1992').toFixed(2)} dB`);
    assert.ok(rows.some(row => row.id === 'voice-level-mix') && rows.some(row => row.id === 'estoi-direct'), 'mix rows, and ESTOI against the known voice');
  });

  it('removes the latency of an effect that has one', async () => {
    const { result, change } = await run('leveling-strong');
    assert.equal(latencyOf(material.mix.channels[0], result.output.channels[0], 960), 0);
    assert.ok(Number.isFinite(change('loudness')));
  });
});
