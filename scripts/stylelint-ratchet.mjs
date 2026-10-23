import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import stylelint from 'stylelint';

const baselinePath = 'config/stylelint-baseline.json';
const cssFiles = ['src/*.css', 'src/ui/**/*.css', 'popup/**/*.css', 'options/**/*.css'];
const root = process.cwd();

// Allowances only move down: growth always fails, and an improvement fails until the
// baseline is lowered (`pnpm lint:css --update`) so the gain cannot silently drift back.
export function compareBaseline(current, baseline) {
  const grown = [];
  const improved = [];
  for (const file of new Set([...Object.keys(current), ...Object.keys(baseline)])) {
    for (const rule of new Set([...Object.keys(current[file] ?? {}), ...Object.keys(baseline[file] ?? {})])) {
      const now = current[file]?.[rule] ?? 0;
      const allowed = baseline[file]?.[rule] ?? 0;
      if (now > allowed) grown.push(`${file}: ${rule} grew from ${allowed} to ${now}`);
      else if (now < allowed) improved.push(`${file}: ${rule} dropped from ${allowed} to ${now}`);
    }
  }
  return { grown, improved };
}

export function assertNoGrowth(current, baseline, { allowImprovement = false } = {}) {
  const { grown, improved } = compareBaseline(current, baseline);
  assert.deepEqual(grown, [], grown.join('\n'));
  if (!allowImprovement) assert.deepEqual(improved, [], `${improved.join('\n')}\nLock in the improvement with: pnpm lint:css --update`);
}

export function readBaseline(source) {
  const value = JSON.parse(source);
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  for (const [file, rules] of Object.entries(value)) {
    assert.ok(rules && typeof rules === 'object' && !Array.isArray(rules), file);
    for (const [rule, count] of Object.entries(rules)) {
      assert.ok(typeof rule === 'string' && Number.isSafeInteger(count) && count > 0, `${file}: ${rule}`);
    }
  }
  return value;
}

export async function inventory(files = cssFiles) {
  const result = await stylelint.lint({ files, configFile: resolve('config/stylelint.config.mjs') });
  const counts = {};
  for (const file of result.results) {
    if (file.parseErrors.length || file.invalidOptionWarnings.length) {
      throw new Error(`${file.source}: Stylelint could not analyze this file`);
    }
    const name = relative(root, file.source).replaceAll('\\', '/');
    for (const warning of file.warnings) {
      const rules = counts[name] ??= {};
      rules[warning.rule] = (rules[warning.rule] ?? 0) + 1;
    }
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

export async function main(args = process.argv.slice(2)) {
  const current = await inventory();
  const baseline = readBaseline(readFileSync(baselinePath, 'utf8'));
  const update = args.includes('--update');
  assertNoGrowth(current, baseline, { allowImprovement: update });
  if (update) writeFileSync(baselinePath, `${JSON.stringify(current, null, 2)}\n`);
  const total = Object.values(current).reduce((sum, rules) => sum + Object.values(rules).reduce((a, b) => a + b, 0), 0);
  console.log(`CSS ratchet passed: ${total} existing violations across ${Object.keys(current).length} files`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
