import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from 'node:test';
import { assertBaselineRatchet, assertNoGrowth, root } from './test-determinism';
import { baselineFile, baselinePath, budgetViolations, countHarness, helperBudget, inventory, readBaseline } from './test-harness';
import type { Inventory } from './test-harness';

// Browser setup lives in src/test-utils (bootPlayer, sharedTestBrowser); legacy copies
// may only be removed. The ratchet compares with the PR's real base (see base-ref.mjs).
it('ratchets hand-rolled browser launches, esbuild bundles and chrome stubs in tests', () => {
  const baseline = readBaseline(readFileSync(join(root, baselinePath), 'utf8'));
  assertBaselineRatchet(baseline, root, Boolean(process.env.CI), baselineFile);
  const current = inventory();
  assertNoGrowth(current, baseline);
  assert.deepEqual(current, baseline, 'setup was removed; run pnpm exec tsx scripts/test-harness.ts --update');
});

it('recognizes launches, esbuild imports and window.chrome stubs but not comparisons or helpers', () => {
  // Assemble fixtures so their example calls do not become baseline allowances.
  const source = [
    ['await chromium.la', 'unch({ headless: true });'],
    ['await (await import("playwright"))[engine].la', 'unch();'],
    ["const esb = require('es", "build');"],
    ["import { buildSync } from 'es", "build';"],
    ['window.chr', 'ome = { storage: {} };'],
  ].map(parts => parts.join('')).join('\n');
  assert.deepEqual(countHarness(source), { launch: 2, esbuild: 2, chromeStub: 1 });
  assert.deepEqual(countHarness('if (window.chrome == null) {} await bootPlayer(page); await shared.newContext(t); page.launchOptions;'), {});
});

it('rejects growth, new files, new kinds and invalid baselines while permitting reductions', () => {
  const previous: Inventory = { 'old.test.ts': { launch: 2 } };
  assertNoGrowth({ 'old.test.ts': { launch: 1 } }, previous);
  assertNoGrowth({}, previous);
  const growing: Inventory[] = [
    { 'old.test.ts': { launch: 3 } },
    { 'new.test.ts': { launch: 1 } },
    { 'old.test.ts': { esbuild: 1 } },
  ];
  for (const next of growing) assert.throws(() => assertNoGrowth(next, previous), /grew/);
  for (const source of ['null', '[]', '{"file":{}}', '{"file":{"launch":-1}}', '{"file":{"unknown":1}}']) {
    assert.throws(() => readBaseline(source));
  }
});

it('scans test files outside src/test-utils only', () => {
  const directory = mkdtempSync(join(tmpdir(), 'test-harness-'));
  try {
    const call = ['await chromium.la', 'unch();'].join('');
    const included = ['src/new.browser.test.ts', 'options/new.test.ts', 'providers/x/deep.test.ts'];
    const excluded = ['src/test-utils/player-boot.ts', 'src/test-utils/helper.test.ts', 'src/runtime.ts', 'scripts/smoke.ts', 'node_modules/vendor.test.ts', 'dist/generated.test.ts'];
    for (const file of [...included, ...excluded]) {
      const path = join(directory, file);
      mkdirSync(join(path, '..'), { recursive: true });
      writeFileSync(path, call);
    }
    const found = inventory(directory);
    assert.deepEqual(Object.keys(found).sort(), included.sort());
    for (const counts of Object.values(found)) assert.deepEqual(counts, { launch: 1 });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it('keeps src/test-utils helpers within the line and option budget', () => {
  assert.deepEqual(helperBudget(), []);
  assert.equal(budgetViolations('a.ts', 'x\n'.repeat(150)).length, 0);
  assert.match(budgetViolations('a.ts', 'x\n'.repeat(151))[0], /151 lines/);
  const options = (count: number) => `export interface BootOptions {\n${Array.from({ length: count }, (_, i) => `  /** doc */\n  o${i}?: boolean;`).join('\n')}\n}\n`;
  assert.deepEqual(budgetViolations('a.ts', options(4)), []);
  assert.match(budgetViolations('a.ts', options(5))[0], /5 options/);
});
