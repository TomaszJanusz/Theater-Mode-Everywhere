import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from 'node:test';
import { assertBaselineRatchet, assertNoGrowth, baselinePath, countWaits, inventory, readBaseline, root } from './test-determinism';
import type { Inventory } from './test-determinism';

// New timing primitives are forbidden; exact per-file/per-kind allowances must
// shrink with removals and cannot grow past the baseline on origin/main.
it('ratchets timing primitives in tests, tools and smoke scripts', () => {
  const baseline = readBaseline(readFileSync(join(root, baselinePath), 'utf8'));
  assertBaselineRatchet(baseline);
  const current = inventory();
  assertNoGrowth(current, baseline);
  assert.deepEqual(current, baseline, 'waits were removed; run pnpm exec tsx scripts/test-determinism.ts --update');
});

it('recognizes timing calls, including serialized browser code and named retries', () => {
  // Assemble fixtures so their example calls do not become baseline allowances.
  const source = [
    ['page.waitFor', 'Timeout (20)'],
    ['new Promise(resolve => set', 'Timeout(resolve, 0))'],
    ['await clock.sl', 'eep(10)'],
    ['await de', 'lay(10)'],
    ['import { setTimeout as pause } fr', "om 'node:timers/promises'"],
    ['page.evaluate(`request', 'AnimationFrame(resolve)`)'],
    ['for (let att', 'empt = 0; attempt < 3; attempt++) {}'],
    ['retri', 'es: 2'],
  ].map(parts => parts.join('')).join('\n');
  assert.deepEqual(countWaits(source), { waitForTimeout: 1, timer: 1, sleep: 2, timerImport: 1, frame: 1, retry: 2 });
  assert.deepEqual(countWaits('await locator.waitFor(); await page.clock.runFor(500);'), {});
});

it('rejects growth, new files, new kinds and invalid baselines while permitting reductions', () => {
  const previous = { 'old.test.ts': { timer: 2 } };
  assertNoGrowth({ 'old.test.ts': { timer: 1 } }, previous);
  assertNoGrowth({}, previous);
  const growing: Inventory[] = [
    { 'old.test.ts': { timer: 3 } },
    { 'new.test.ts': { timer: 1 } },
    { 'old.test.ts': { sleep: 1 } },
  ];
  for (const next of growing) assert.throws(() => assertNoGrowth(next, previous), /grew/);
  for (const source of ['null', '[]', '{"file":{}}', '{"file":{"timer":-1}}', '{"file":{"unknown":1}}']) {
    assert.throws(() => readBaseline(source));
  }
});

it('discovers new tests and tool/smoke code without scanning production or generated output', () => {
  const directory = mkdtempSync(join(tmpdir(), 'test-determinism-'));
  try {
    const call = ['page.waitFor', 'Timeout(10);'].join('');
    const included = ['src/new.browser.test.ts', 'options/new.test.ts', 'tools/nested/probe.ts', 'scripts/smoke-extra.ts'];
    const excluded = ['src/runtime.ts', 'scripts/build.ts', 'node_modules/vendor.test.ts', 'dist/generated.test.ts'];
    for (const file of [...included, ...excluded]) {
      const path = join(directory, file);
      mkdirSync(join(path, '..'), { recursive: true });
      writeFileSync(path, call);
    }
    const found = inventory(directory);
    assert.deepEqual(Object.keys(found).sort(), included.sort());
    for (const counts of Object.values(found)) assert.deepEqual(counts, { waitForTimeout: 1 });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
