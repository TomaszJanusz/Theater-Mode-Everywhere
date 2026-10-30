import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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
    const included = ['src/new.browser.test.ts', 'options/new.test.ts', 'tools/nested/probe.ts', 'src/test-utils/player-scenarios/fixture.ts', 'scripts/smoke-extra.ts', 'scripts/smoke/nested/scenario.ts'];
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

it('allows a missing remote ref locally but rejects it in CI', t => {
  const directory = mkdtempSync(join(tmpdir(), 'determinism-no-remote-'));
  const warning = t.mock.method(console, 'warn', () => {});
  try {
    execFileSync('git', ['init', '--quiet', directory]);
    assertBaselineRatchet({}, directory, false);
    assert.equal(warning.mock.callCount(), 1);
    assert.match(String(warning.mock.calls[0].arguments[0]), /Skipping only the local history comparison/);
    const previous = process.env.GITHUB_BASE_REF;
    try {
      delete process.env.GITHUB_BASE_REF;
      assert.throws(() => assertBaselineRatchet({}, directory, true), /requires origin\/main/);
      process.env.GITHUB_BASE_REF = 'dev';
      assert.throws(() => assertBaselineRatchet({}, directory, true), /requires origin\/dev/);
    } finally {
      if (previous === undefined) delete process.env.GITHUB_BASE_REF;
      else process.env.GITHUB_BASE_REF = previous;
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it('keeps the base allowance of a file this branch moved, and still rejects its growth', () => {
  const directory = mkdtempSync(join(tmpdir(), 'determinism-move-'));
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd: directory, stdio: 'pipe' });
  try {
    git('init', '--quiet');
    mkdirSync(join(directory, 'scripts'));
    mkdirSync(join(directory, 'old'));
    writeFileSync(join(directory, 'old/wait.test.ts'), 'await poll();\n'.repeat(20));
    writeFileSync(join(directory, baselinePath), JSON.stringify({ 'old/wait.test.ts': { timer: 1 } }));
    git('add', '-A');
    git('commit', '--quiet', '-m', 'base');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    mkdirSync(join(directory, 'new'));
    git('mv', 'old/wait.test.ts', 'new/wait.test.ts');
    writeFileSync(join(directory, baselinePath), JSON.stringify({ 'new/wait.test.ts': { timer: 1 } }));
    git('commit', '--quiet', '-am', 'move');
    const previous = process.env.GITHUB_BASE_REF;
    delete process.env.GITHUB_BASE_REF;
    try {
      assertBaselineRatchet({ 'new/wait.test.ts': { timer: 1 } }, directory, true);
      assert.throws(() => assertBaselineRatchet({ 'new/wait.test.ts': { timer: 2 } }, directory, true), /new\/wait\.test\.ts: timer grew from 1 to 2/);
    } finally {
      if (previous !== undefined) process.env.GITHUB_BASE_REF = previous;
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
