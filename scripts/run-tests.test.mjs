import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { discoverTests, isBrowserTest, main, planRun } from './run-tests.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

test('discovery finds nested tests deterministically and skips generated trees', () => {
  const root = mkdtempSync(join(tmpdir(), 'run-tests-'));
  try {
    for (const file of ['b.test.ts', 'a/z.browser.test.ts', 'a/y.test.mjs', 'node_modules/x/x.test.ts', 'dist/d.test.ts', '.git/g.test.ts', 'helper.ts', 'a/notes.test.md']) {
      mkdirSync(join(root, file, '..'), { recursive: true });
      writeFileSync(join(root, file), '');
    }
    assert.deepEqual(discoverTests(root), ['a/y.test.mjs', 'a/z.browser.test.ts', 'b.test.ts']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('planRun routes by extension, filters by path and forwards flags', () => {
  const all = ['scripts/a.test.mjs', 'src/x/foo.test.ts', 'src/y/bar.browser.test.ts'];
  assert.deepEqual(planRun(all, []).tsx.files, ['src/x/foo.test.ts', 'src/y/bar.browser.test.ts']);
  assert.deepEqual(planRun(all, []).node.files, ['scripts/a.test.mjs']);
  const plan = planRun(all, ['--', 'bar', '--test-name-pattern=ok']);
  assert.deepEqual(plan.tsx, { files: ['src/y/bar.browser.test.ts'], flags: ['--test-name-pattern=ok'] });
  assert.deepEqual(plan.node.files, []);
  assert.throws(() => planRun(all, ['missing']), /No test file matches/);
});

test('every tracked test file is discovered', () => {
  const tracked = execFileSync('git', ['ls-files', '-z', '--', '*.test.ts', '*.test.mjs'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\0').filter(Boolean);
  const discovered = new Set(discoverTests(repoRoot));
  assert.deepEqual(tracked.filter(file => !discovered.has(file)), []);
});

test('no tracked test-like file uses an extension the runner would skip', () => {
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' }).split('\0').filter(Boolean);
  const unrun = tracked.filter(file => /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file) && !/\.test\.(?:ts|mjs)$/.test(file));
  assert.deepEqual(unrun, []);
});

test('forwards arguments verbatim to the child process without a shell', () => {
  const root = mkdtempSync(join(tmpdir(), 'run-tests-'));
  try {
    writeFileSync(join(root, 'a b.test.ts'), '');
    const calls = [];
    const status = main(['--test-name-pattern=it "x" & y | $HOME', 'a b'], root, (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0 };
    });
    assert.equal(status, 0);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, process.execPath);
    assert.equal(calls[0].options.shell, undefined);
    assert.deepEqual(calls[0].args.slice(1), ['--test', '--test-concurrency=2', '--test-name-pattern=it "x" & y | $HOME', 'a b.test.ts']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('lanes partition discovery exactly once, including legacy browser filenames', () => {
  const discovered = discoverTests(repoRoot);
  const classify = file => isBrowserTest(join(repoRoot, file));
  const files = lane => {
    const plan = planRun(discovered, [`--lane=${lane}`], classify);
    return [...plan.node.files, ...plan.tsx.files];
  };
  const unit = files('unit');
  const browser = files('browser');
  assert.ok(browser.includes('src/playlist-nav.test.ts'));
  assert.ok(browser.includes('src/test-utils/test-browser.test.ts'));
  assert.ok(unit.includes('scripts/run-tests.test.mjs'));
  assert.deepEqual(unit.filter(file => browser.includes(file)), []);
  assert.deepEqual([...unit, ...browser].sort(), discovered);
  assert.throws(() => planRun(discovered, ['--lane=typo']), /Unknown test lane/);
});
