import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { balanceShard, discoverTests, isBrowserTest, main, parseShardCosts, planRun, tallyProblems } from './run-tests.mjs';

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

test('cost-balanced shards cover every file exactly once and even out the load', () => {
  const costs = { files: { 'a.test.ts': 100, 'b.test.ts': 60, 'c.test.ts': 50, 'd.test.ts': 40, 'e.test.ts': 10 } };
  const files = ['a.test.ts', 'b.test.ts', 'c.test.ts', 'd.test.ts', 'e.test.ts', 'new.test.ts'];
  for (const total of [1, 2, 3, 4]) {
    const shards = Array.from({ length: total }, (_, shard) => balanceShard(files, costs, shard + 1, total));
    assert.deepEqual(shards.flat().sort(), [...files].sort(), `${total} shards`);
  }
  // The unmeasured file weighs the median (50): 100+10 | 60+40 | 50+50.
  assert.deepEqual(balanceShard(files, costs, 1, 3), ['a.test.ts', 'e.test.ts']);
  assert.deepEqual(balanceShard(files, costs, 2, 3), ['b.test.ts', 'd.test.ts']);
  assert.deepEqual(balanceShard(files, costs, 3, 3), ['c.test.ts', 'new.test.ts']);
  // A shard that also runs Storybook starts with that work already on its load.
  const withStorybook = { files: costs.files, overhead: { 1: 100 } };
  const three = ['a.test.ts', 'b.test.ts', 'c.test.ts'];
  assert.deepEqual(balanceShard(three, withStorybook, 1, 2), ['b.test.ts']);
  assert.deepEqual(balanceShard(three, withStorybook, 2, 2), ['a.test.ts', 'c.test.ts']);
  assert.deepEqual(balanceShard(['x.test.ts', 'y.test.ts'], { files: {} }, 2, 2), ['y.test.ts']);
});

test('--shard-costs replaces the count-based split of --test-shard in every group', () => {
  const all = ['scripts/a.test.mjs', 'src/x/foo.browser.test.ts', 'src/y/bar.browser.test.ts', 'src/ui/menu.component.test.ts'];
  const costs = { files: { 'src/x/foo.browser.test.ts': 30, 'src/y/bar.browser.test.ts': 20, 'src/ui/menu.component.test.ts': 20 } };
  const plans = [1, 2].map(index => planRun(all, ['--lane=browser', `--test-shard=${index}/2`, '--test-concurrency=1'], undefined, costs));
  assert.deepEqual(plans.map(plan => plan.tsx.files), [['src/x/foo.browser.test.ts'], ['src/y/bar.browser.test.ts']]);
  assert.deepEqual(plans.map(plan => plan.vitest.files), [[], ['src/ui/menu.component.test.ts']]);
  for (const plan of plans) {
    assert.deepEqual(plan.tsx.flags, ['--test-concurrency=1']);
    assert.deepEqual(plan.vitest.flags, []);
  }
  assert.throws(() => planRun(all, ['--lane=browser'], undefined, costs), /needs --test-shard/);
  assert.throws(() => planRun(all, ['--test-shard=3/2'], undefined, costs), /needs --test-shard/);
});

test('shard cost tables must hold non-negative seconds', () => {
  assert.deepEqual(parseShardCosts('{"files":{"a.test.ts":1.5},"overhead":{"1":40}}').overhead, { 1: 40 });
  for (const text of ['null', '{}', '{"files":{"a":"1"}}', '{"files":{"a":-1}}', '{"files":{},"overhead":{"1":null}}']) {
    assert.throws(() => parseShardCosts(text), /Invalid shard cost table/, text);
  }
});

test('component tests run once in Vitest, in the browser lane, with translated flags', () => {
  const all = ['scripts/a.test.mjs', 'src/x/foo.test.ts', 'src/y/bar.browser.test.ts', 'src/ui/menu.component.test.ts'];
  const plan = planRun(all, ['menu', '--test-name-pattern=Escape', '--test-shard=2/2', '--test-concurrency=1']);
  assert.deepEqual(plan.tsx.files, []);
  assert.deepEqual(plan.vitest, { files: ['src/ui/menu.component.test.ts'], flags: ['-t', 'Escape', '--shard=2/2', '--passWithNoTests'] });
  assert.deepEqual(planRun(all, ['--lane=unit']).vitest.files, []);
  assert.deepEqual(planRun(all, ['--lane=browser']).vitest.files, ['src/ui/menu.component.test.ts']);
  assert.deepEqual(planRun(all, ['--lane=browser']).tsx.files, ['src/y/bar.browser.test.ts']);

  const root = mkdtempSync(join(tmpdir(), 'run-tests-vitest-'));
  try {
    for (const file of ['a.browser.test.ts', 'b.component.test.ts']) writeFileSync(join(root, file), '');
    const calls = [];
    const reportDirectory = join(root, 'reports');
    const spawn = (_command, args) => { calls.push(args); return { status: 0 }; };
    assert.equal(main(['--lane=browser', `--report-dir=${reportDirectory}`], root, spawn), 0);
    assert.equal(calls.length, 2, 'the tsx group runs first, then Vitest');
    assert.ok(calls[1][0].endsWith('vitest.mjs'));
    assert.deepEqual(calls[1].slice(1), ['run', '--config', 'vitest.config.ts', '--project', 'components',
      '--reporter=default', '--reporter=junit', `--outputFile.junit=${join(reportDirectory, 'vitest.xml')}`, 'b.component.test.ts']);
    calls.length = 0;
    assert.equal(main([], root, (_command, args) => { calls.push(args); return { status: 3 }; }), 3);
    assert.equal(calls.length, 1, 'a failed tsx group stops before Vitest');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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
    const { args } = calls[0];
    assert.deepEqual(args.slice(1, 3), ['--test', '--test-concurrency=2']);
    assert.ok(!args.includes('--test-force-exit'), 'a forced exit cuts off results the reporters still hold');
    assert.deepEqual(args.slice(-2), ['--test-name-pattern=it "x" & y | $HOME', 'a b.test.ts']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('JUnit reporting is opt-in and does not pass its option to Node', () => {
  const root = mkdtempSync(join(tmpdir(), 'run-tests-report-'));
  try {
    writeFileSync(join(root, 'sample.test.mjs'), '');
    const calls = [];
    const reportDirectory = join(root, 'reports');
    const spawn = (_command, args) => { calls.push(args); return { status: 0 }; };
    assert.equal(main([`--report-dir=${reportDirectory}`], root, spawn), 0);
    const [guard, ...reporters] = calls[0].slice(1, -1);
    assert.equal(calls[0][0], '--test');
    assert.match(guard, /^--import=file:\/\/.*\/test-process-guard\.mjs\?tally=/);
    assert.deepEqual(reporters.slice(0, 4), [
      '--test-reporter=spec', '--test-reporter-destination=stdout',
      '--test-reporter=junit', `--test-reporter-destination=${join(reportDirectory, 'node.xml')}`,
    ]);
    assert.match(reporters[4], /^--test-reporter=file:\/\/.*\/test-tally-reporter\.mjs$/);
    assert.equal(calls[0].at(-1), 'sample.test.mjs');
    calls.length = 0;
    assert.equal(main([], root, spawn), 0);
    assert.ok(!calls[0].some(arg => arg.includes('junit')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a run is incomplete when fewer tests reached the reporters than ran', () => {
  const ran = new Map([['a.test.ts', 100], ['b.test.ts', 100]]);
  assert.deepEqual(tallyProblems(ran, { 'a.test.ts': 100, 'b.test.ts': 100 }, 0), []);
  assert.deepEqual(tallyProblems(ran, { 'a.test.ts': 100, 'b.test.ts': 87 }, 0), ['b.test.ts: 100 tests ran, 87 reached the reporters']);
  assert.deepEqual(tallyProblems(ran, { 'a.test.ts': 100 }, 1), ['b.test.ts: 100 tests ran, 0 reached the reporters']);
  assert.deepEqual(tallyProblems(ran, null, 0), ['the reporters wrote no tally, but 200 tests ran']);
  assert.deepEqual(tallyProblems(new Map(), null, 0), [], 'a run that executed nothing has nothing to lose');
});

test('a green run must match exactly, a failed run may report extra entries for crashed files', () => {
  const ran = new Map([['a.test.ts', 2]]);
  assert.equal(tallyProblems(ran, { 'a.test.ts': 3 }, 0).length, 1);
  assert.equal(tallyProblems(ran, { 'a.test.ts': 2, 'crashed.test.ts': 1 }, 0).length, 1);
  assert.deepEqual(tallyProblems(ran, { 'a.test.ts': 2, 'crashed.test.ts': 1 }, 1), []);
});

// A fixture suite shaped like the failure: 500 trivial tests across five files, the first leaking a handle
// that keeps its process alive, and a last failing test. With `--test-force-exit` the runner exited before its
// reporters had drained, so the count in the JUnit report changed from run to run while the exit code stayed 0.
function writeLeakyFixture(root) {
  for (let file = 0; file < 5; file += 1) {
    const cases = Array.from({ length: 100 }, (_, index) => `test('case ${index}', () => {});`);
    if (file === 0) cases.push('setInterval(() => {}, 60_000);');
    writeFileSync(join(root, `suite-${file}.test.ts`), `import test from 'node:test';\n${cases.join('\n')}\n`);
  }
  writeFileSync(join(root, 'zz-last.test.ts'), `import test from 'node:test';\ntest('last', () => { throw new Error('expected failure'); });\n`);
}

// Runs the real runner on a fixture directory: a shorter leak grace keeps it quick, output stays out of the log.
function runFixture(root, reportDirectory) {
  const warnings = [];
  const originalWarn = console.warn;
  const originalError = console.error;
  console.warn = message => warnings.push(message);
  console.error = message => warnings.push(message);
  try {
    // This process is itself a test file process; the nested runner must not inherit that role.
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const spawn = (command, args, options) => spawnSync(command, args.map(arg => arg.replace(/^(--import=.*)$/, '$1&graceMs=1000')), { ...options, cwd: root, env, stdio: 'ignore' });
    const status = main([`--report-dir=${reportDirectory}`], root, spawn);
    const xml = readdirSync(reportDirectory).map(name => readFileSync(join(reportDirectory, name), 'utf8')).join('');
    return { status, warnings, testcases: xml.match(/<testcase /g)?.length ?? 0, closed: xml.includes('</testsuites>') };
  } finally {
    console.warn = originalWarn;
    console.error = originalError;
  }
}

test('every test of a suite with a leaked handle reaches the report, the handle is named and a failure still fails', () => {
  const root = mkdtempSync(join(tmpdir(), 'run-tests-leak-'));
  try {
    writeLeakyFixture(root);
    const result = runFixture(root, join(root, 'reports'));
    assert.equal(result.status, 1, 'the failing last test fails the run');
    assert.equal(result.testcases, 501);
    assert.ok(result.closed);
    assert.ok(!result.warnings.some(message => /lost between/.test(message)), 'no results are lost');
    assert.ok(result.warnings.some(message => /suite-0\.test\.ts left handles alive after its tests finished \(Timeout x1\)/.test(message)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('lanes partition discovery exactly once, including legacy browser filenames', () => {
  const discovered = discoverTests(repoRoot);
  const classify = file => isBrowserTest(join(repoRoot, file));
  const files = lane => {
    const plan = planRun(discovered, [`--lane=${lane}`], classify);
    return [...plan.node.files, ...plan.tsx.files, ...plan.vitest.files];
  };
  const unit = files('unit');
  const browser = files('browser');
  assert.ok(browser.includes('src/playlist-nav.test.ts'));
  assert.ok(browser.includes('src/ui/surfaces.component.test.ts'));
  assert.ok(browser.includes('src/test-utils/test-browser.test.ts'));
  assert.ok(unit.includes('scripts/run-tests.test.mjs'));
  assert.deepEqual(unit.filter(file => browser.includes(file)), []);
  assert.deepEqual([...unit, ...browser].sort(), discovered);
  assert.throws(() => planRun(discovered, ['--lane=typo']), /Unknown test lane/);
});

test('selected static-preview tests build once before workers; other selections skip the build', () => {
  const root = mkdtempSync(join(tmpdir(), 'run-tests-storybook-'));
  try {
    for (const file of ['profiles', 'timeline']) {
      writeFileSync(join(root, `${file}.browser.test.ts`), `import { serveStorybook } from '../.storybook/static-server';`);
    }
    writeFileSync(join(root, 'dev.browser.test.ts'), '');
    const files = discoverTests(root);
    writeFileSync(join(root, 'selection.json'), JSON.stringify({ total: files.length, files: files.filter(file => !file.startsWith('dev')) }));
    const calls = [];
    const spawn = (_command, args, options) => { calls.push({ args, options }); return { status: 0 }; };
    assert.equal(main(['--lane=browser', '--files-from=selection.json'], root, spawn), 0);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].args.slice(1), ['build', '--output-dir', 'output/storybook-static']);
    assert.equal(calls[0].options.cwd, root);
    assert.deepEqual(calls[1].args.slice(-2), ['profiles.browser.test.ts', 'timeline.browser.test.ts']);
    calls.length = 0;
    assert.equal(main(['dev'], root, spawn), 0);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].args.includes('--test'));
    calls.length = 0;
    assert.equal(main(['profiles'], root, (_command, args) => { calls.push(args); return { status: 7 }; }), 7);
    assert.equal(calls.length, 1, 'a failed build must stop before browser workers');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
