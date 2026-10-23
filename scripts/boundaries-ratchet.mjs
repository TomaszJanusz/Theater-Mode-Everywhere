import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const depcruiseBin = resolve('node_modules/dependency-cruiser/bin/dependency-cruiser.mjs');
const knownPath = 'config/.dependency-cruiser-known-violations.json';
const limitPath = 'config/boundaries-baseline.json';
const roots = ['src', 'popup', 'options'];

const keyOf = violation => [violation.rule.name, violation.from, violation.to, ...(violation.cycle?.map(step => step.name) ?? [])].join('\t');

// Known violations are debt: they may be paid off but never added. Stale entries
// fail too, so the file shrinks in the same change that fixes an import, and the
// recorded count catches entries added by hand for a violation that is still live.
export function compareKnown(current, known, limit) {
  const currentKeys = new Set(current.map(keyOf));
  const knownKeys = new Set(known.map(keyOf));
  const added = current.filter(violation => !knownKeys.has(keyOf(violation)));
  const stale = known.filter(violation => !currentKeys.has(keyOf(violation)));
  const problems = [
    ...added.map(v => `new violation of ${v.rule.name}: ${v.from} -> ${v.to}`),
    ...stale.map(v => `stale known violation (fixed, remove it): ${v.rule.name}: ${v.from} -> ${v.to}`),
  ];
  if (known.length > limit) problems.push(`known violations grew to ${known.length}; the recorded limit is ${limit}`);
  if (!stale.length && known.length < limit) problems.push(`recorded limit ${limit} is above ${known.length} known violations; lower it`);
  return { problems, remaining: known.filter(v => currentKeys.has(keyOf(v))) };
}

export function readLimit(source) {
  const value = JSON.parse(source);
  assert.ok(Number.isSafeInteger(value?.knownViolations) && value.knownViolations >= 0, 'knownViolations must be a non-negative integer');
  return value.knownViolations;
}

function analyze() {
  const result = spawnSync(process.execPath, [depcruiseBin, '--config', 'config/dependency-cruiser.cjs', '--output-type', 'json', ...roots], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  assert.ifError(result.error);
  // depcruise exits non-zero when it reports violations, so judge its JSON, not its status.
  const report = JSON.parse(result.stdout);
  return report.summary.violations.filter(violation => violation.rule.severity === 'error');
}

export function main(args = process.argv.slice(2)) {
  const known = JSON.parse(readFileSync(knownPath, 'utf8'));
  const limit = readLimit(readFileSync(limitPath, 'utf8'));
  const { problems, remaining } = compareKnown(analyze(), known, limit);
  if (args.includes('--update')) {
    // Only stale entries are removed; new violations must be fixed, never recorded.
    const unresolved = problems.filter(problem => problem.startsWith('new violation'));
    if (unresolved.length) throw new Error(unresolved.join('\n'));
    writeFileSync(knownPath, `${JSON.stringify(remaining, null, 2)}\n`);
    writeFileSync(limitPath, `${JSON.stringify({ knownViolations: remaining.length }, null, 2)}\n`);
    console.log(`Boundary baseline updated: ${remaining.length} known violations`);
    return;
  }
  if (problems.length) throw new Error(`${problems.join('\n')}\nRemove fixed entries with: pnpm check:boundaries --update`);
  console.log(`Module boundaries passed: ${known.length} known violations remain`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
