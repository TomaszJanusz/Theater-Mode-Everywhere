import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { changedFiles, impact, isFullRun, readGraph, selectTests } from './test-impact.mjs';
import { main } from './run-tests.mjs';

const tests = ['src/a.test.ts', 'src/b.test.ts'];
const graph = new Map([
  ['src/a.test.ts', new Set(['src/middle.ts'])],
  ['src/middle.ts', new Set(['src/leaf.ts'])],
  ['src/leaf.ts', new Set(['src/middle.ts'])],
  ['src/b.test.ts', new Set()],
]);

test('transitive imports select their test, exclude unrelated tests, and tolerate cycles', () => {
  const result = selectTests(tests, ['src/leaf.ts'], graph, ['src/middle.ts']);
  assert.deepEqual(result.files, [tests[0]]);
  assert.equal(result.smoke, true);
  assert.equal(result.full, false);
  assert.deepEqual(selectTests(tests, [tests[1]], graph, []).files, [tests[1]]);
  assert.equal(selectTests(tests, [tests[1]], graph, []).smoke, false);
});

test('shared inputs and unreadable/unknown graphs fail open to all tests and smoke', () => {
  for (const file of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.json', 'manifest.json', 'scripts/build-mode.ts', 'vite.config.ts', 'scripts/run-tests.mjs', 'scripts/ci-changes.mjs', 'scripts/test-impact.mjs', 'src/test-utils/a.ts', 'test-utils/a.ts', 'test/fixtures/a.webm', '.github/workflows/ci.yml', 'src/ui/shadow.css']) {
    assert.equal(isFullRun(file), true, file);
    assert.deepEqual(selectTests(tests, [file], graph).files, tests);
  }
  for (const changed of [[], ['src/leaf.ts'], ['unknown.asset']]) {
    const result = selectTests(tests, changed, null);
    assert.deepEqual(result.files, tests);
    assert.equal(result.smoke, true);
  }
  assert.equal(selectTests(tests, ['unknown.asset'], graph).full, true);
});

test('catalog edits select locale consumers without selecting unrelated playback tests', () => {
  const files = ['scripts/locales.test.ts', 'src/i18n.test.ts', 'options/localization.browser.test.ts', ...tests];
  assert.deepEqual(selectTests(files, ['_locales/pl/messages.json'], graph, []).files, files.slice(0, 3));
});

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'impact-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (file, text) => { mkdirSync(join(root, file, '..'), { recursive: true }); writeFileSync(join(root, file), text); };
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  return { root, put, git };
}

test('real esbuild graph includes transitive, type-only and embedded browser imports', async t => {
  const { root, put } = fixture(t);
  const files = ['src/a.test.ts', 'src/middle.ts', 'src/leaf.ts', 'src/b.test.ts', 'src/embedded.test.ts'];
  put(files[0], "import './middle';");
  put(files[1], "export type { Leaf } from './leaf';");
  put(files[2], 'export type Leaf = string;');
  put(files[3], 'export {};');
  put(files[4], "const stdin = `import { Leaf } from './src/leaf';`; export { stdin };");
  const actual = await readGraph(root, files, []);
  assert.deepEqual(selectTests([files[0], files[3], files[4]], [files[2]], actual, []).files, [files[0], files[4]]);
});

test('both sides of renames/deletions count; retained base edges select surviving tests', t => {
  const { root, put, git } = fixture(t);
  put('src/old.ts', 'export const a = 1;');
  put('src/removed.ts', 'export {};');
  git('add', '.'); git('commit', '-qm', 'base');
  git('mv', 'src/old.ts', 'src/new.ts'); git('rm', '-q', 'src/removed.ts'); git('commit', '-qm', 'rename and delete');
  assert.deepEqual(changedFiles('HEAD^', 'HEAD', root), ['src/new.ts', 'src/old.ts', 'src/removed.ts']);
  const oldEdges = new Map([...graph, ['src/a.test.ts', new Set(['src/old.ts'])], ['src/old.ts', new Set()]]);
  assert.deepEqual(selectTests(tests, changedFiles('HEAD^', 'HEAD', root), new Map([...oldEdges, ['src/new.ts', new Set()], ['src/removed.ts', new Set()]]), []).files, [tests[0]]);
});

test('graph read/build failure returns full selection, never an empty success', async t => {
  const { root, put, git } = fixture(t);
  put('src/a.test.ts', "import './missing';");
  git('add', '.'); git('commit', '-qm', 'base');
  put('src/a.test.ts', "import './missing'; // change");
  git('add', '.'); git('commit', '-qm', 'change');
  const result = await impact({ root, base: 'HEAD^' });
  assert.deepEqual(result.files, ['src/a.test.ts']);
  assert.equal(result.full, true);
  assert.match(result.reason, /Fallback/);
});

test('runner uses exact file lists, accepts deliberate empty lanes and fails open on invalid input', t => {
  const { root, put } = fixture(t);
  put('a.test.mjs', ''); put('ab.test.mjs', '');
  const calls = [];
  const spawn = (_, args) => { calls.push(args); return { status: 0 }; };
  put('selection.json', JSON.stringify({ total: 2, files: ['a.test.mjs'] }));
  assert.equal(main(['--files-from=selection.json'], root, spawn), 0);
  assert.deepEqual(calls.pop(), ['--test', 'a.test.mjs']);
  put('selection.json', JSON.stringify({ total: 2, files: [] }));
  assert.equal(main(['--files-from=selection.json'], root, spawn), 0);
  assert.equal(calls.length, 0);
  put('selection.json', '{');
  main(['--files-from=selection.json'], root, spawn);
  assert.deepEqual(calls.pop(), ['--test', 'a.test.mjs', 'ab.test.mjs']);
  main([], root, spawn);
  assert.deepEqual(calls.pop(), ['--test', 'a.test.mjs', 'ab.test.mjs']);
});

test('test-only shared infrastructure keeps full tests but skips installed smoke', () => {
  const result = selectTests(tests, ['src/test-utils/helper.ts'], graph, ['src/leaf.ts']);
  assert.deepEqual(result.files, tests);
  assert.equal(result.smoke, false);
});

test('base graph preserves removed imports and dist tests follow installed entrypoints', async t => {
  const { root, put, git } = fixture(t);
  const entries = ['src/entries/content.ts', 'src/entries/main-world.ts', 'src/entries/background.ts', 'popup/popup.ts', 'options/options.ts'];
  for (const file of entries) put(file, 'export {};');
  put('src/leaf.ts', 'export const value = 1;');
  put('src/a.test.ts', "import './leaf';");
  put('src/dist.browser.test.ts', "export const dir = 'dist/chrome-unpacked';");
  git('add', '.'); git('commit', '-qm', 'base');
  put('src/a.test.ts', 'export {};');
  git('rm', '-q', 'src/leaf.ts'); git('add', '.'); git('commit', '-qm', 'delete imported source');
  const result = await impact({ root, base: 'HEAD^' });
  assert.deepEqual(result.files, ['src/a.test.ts']);
  assert.equal(result.full, false);
  const actual = await readGraph(root, [...entries, 'src/dist.browser.test.ts']);
  assert.deepEqual(selectTests(['src/dist.browser.test.ts'], [entries[0]], actual).files, ['src/dist.browser.test.ts']);
});

test('computed module inputs are uncertain and cannot silently produce an empty selection', async t => {
  const { root, put } = fixture(t);
  const code = ['const input = "./a"; imp', 'ort(input);'].join('');
  put('src/a.test.ts', code);
  await assert.rejects(readGraph(root, ['src/a.test.ts'], []), /Computed module input/);
});

test('only the existing reviewed-prose exemptions can skip unknown documentation inputs', () => {
  const result = selectTests(tests, ['docs/guide.md'], graph, []);
  assert.deepEqual(result.files, []);
  assert.equal(result.smoke, false);
  assert.equal(selectTests(tests, ['docs/building.md'], graph, []).full, true);
});

test('build dependencies also keep installed Chromium smoke', () => {
  const actual = new Map([...graph,
    ['scripts/build.ts', new Set(['scripts/bundle-integrity.ts'])],
    ['scripts/bundle-integrity.ts', new Set()],
  ]);
  assert.equal(selectTests(tests, ['scripts/bundle-integrity.ts'], actual).smoke, true);
});
