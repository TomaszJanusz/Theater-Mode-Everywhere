import assert from 'node:assert/strict';
import { it } from 'node:test';
import { counterDelta, validateCounters } from './resource-probe';
import { FIXTURES, resourceOptions, resourceReport } from './resource-model';
it('resource CLI rejects unavailable diagnostics and malformed runs before browser launch', () => {
  const base = ['--build-a', '/tmp/build', '--output', '/tmp/results'];
  assert.equal(resourceOptions(base).cycles, 20);
  for (const extra of [['--cycles', '19'], ['--rounds', '0'], ['--browser', 'webkit'], ['--heap', 'yes'], ['--output', '/tmp/other'], ['--unknown', 'x'], ['--fixtures', 'wrong'], ['--fixtures', 'chat-live,chat-live'], ['--browser', 'firefox', '--heap', 'true']]) {
    assert.throws(() => resourceOptions([...base, ...extra]));
  }
  assert.throws(() => resourceOptions([]));
  assert.equal(resourceOptions([...base, '--build-b', '/tmp/other']).buildB, '/tmp/other');
});
it('counters preserve active gauges and validate external readouts', () => {
  const active = { observers: 1, timeouts: 0, intervals: 2, raf: 0, pendingReads: 0 };
  const before = { totals: { querySelector: 5 }, active }, after = { totals: { querySelector: 8, rect: 2 }, active };
  validateCounters(after); assert.deepEqual(counterDelta(before, after), { querySelector: 3, rect: 2 });
  for (const value of [null, { totals: {}, active: {} }, { totals: { rect: NaN }, active }, { totals: {}, active: { ...active, intervals: -1 } }]) assert.throws(() => validateCounters(value));
});
it('matrix and report distinguish fixtures, rejected samples, heap gaps and runtime proof', () => {
  assert.equal(new Set(FIXTURES).size, 15);
  const report = resourceReport([]);
  assert.match(report, /NOT an installed-extension/); assert.match(report, /not peak memory/); assert.match(report, /Rejected samples: 0/);
});
it('resource pairing excludes a successful half and mismatched phases', async () => {
  const { completeResourcePair, phase } = await import('./resource-model');
  const counters = { totals: {}, active: { observers: 0, timeouts: 0, intervals: 0, raf: 0, pendingReads: 0 } };
  const make = (id: string) => ({ fixture: 'generic-mousemove' as const, build: { id, path: '/tmp/build', hash: id, version: '1', sourceSha: null },
    round: 1, accepted: true, reason: null as string | null, phases: [phase('moves', counters, counters, {}, null)], errors: [], heap: null });
  const a = make('A'), b = make('B'); b.accepted = false; b.reason = 'setup failure';
  completeResourcePair([a, b], 2); assert.equal(a.accepted, false); assert.equal(b.reason, 'setup failure');
  const c = make('A'), d = make('B'); d.phases[0].name = 'wrong';
  completeResourcePair([c, d], 2); assert.equal(c.reason, 'Mismatched fixture phases');
});
