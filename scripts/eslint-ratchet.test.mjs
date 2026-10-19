import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const eslintBin = join(dirname(require.resolve('eslint/package.json')), 'bin/eslint.js');
const config = resolve('config/eslint.config.mjs');

test('bulk baseline rejects new size/HTML violations and pruning removes resolved debt', t => {
  const cwd = mkdtempSync(join(tmpdir(), 'tme-eslint-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  mkdirSync(join(cwd, 'src'));
  const put = (name, source) => writeFileSync(join(cwd, 'src', name), source);
  const lint = (...args) => {
    const result = spawnSync(process.execPath, [eslintBin, '.', '--config', config, '--max-warnings', '0', ...args], {
      cwd, encoding: 'utf8', timeout: 30_000,
    });
    assert.ifError(result.error);
    return { status: result.status, output: result.stdout + result.stderr };
  };
  const baseline = () => JSON.parse(readFileSync(join(cwd, 'eslint-suppressions.json'), 'utf8'));

  put('legacy.ts', 'export function legacy(a, b, c, d, e) { console.log(a, b, c, d, e); }\n');
  assert.equal(lint('--suppress-all').status, 0);
  assert.equal(lint().status, 0);
  const before = baseline();
  assert.equal(before['src/legacy.ts']['max-params'].count, 1);

  // Opening + 119 statements + closing = 121 nonblank, noncomment lines.
  put('growth.ts', `export function oversized() {\n${'console.log(1);\n'.repeat(119)}}\n`);
  let result = lint();
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /max-lines-per-function/);
  rmSync(join(cwd, 'src/growth.ts'));

  for (const sink of ['el.innerHTML = value', 'el["outerHTML"] += value', 'el.insertAdjacentHTML("beforeend", value)']) {
    put('growth.ts', `export function render(el, value) { ${sink}; }\n`);
    result = lint();
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /no-restricted-syntax/);
    assert.match(result.output, /safe DOM builder/);
  }
  rmSync(join(cwd, 'src/growth.ts'));

  put('legacy.ts', 'export function legacy(a, b, c, d) { console.log(a, b, c, d); }\n');
  assert.notEqual(lint().status, 0, 'stale allowances must require pruning');
  result = lint('--prune-suppressions');
  assert.equal(result.status, 0, result.output);
  assert.deepEqual(baseline(), {});
  assert.equal(lint().status, 0);
});
