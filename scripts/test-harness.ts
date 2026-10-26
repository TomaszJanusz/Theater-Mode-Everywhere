import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { assertBaselineRatchet, assertNoGrowth, root, walkFiles } from './test-determinism';
import type { BaselineFile } from './test-determinism';

// Textual ratchet for hand-rolled browser-test setup. A test boots the player with
// src/test-utils/player-boot.ts and owns its browser through test-browser.ts; the
// patterns below belong in those helpers only. Per-file allowances are exact and
// --update only accepts reductions, so the legacy copies disappear as files migrate.
const rules = {
  launch: /\.launch\s*\(/g,
  esbuild: /['"]esbuild['"]/g,
  chromeStub: /\bwindow\.chrome\s*=(?!=)/g,
};
type Kind = keyof typeof rules;
export type Inventory = Record<string, Partial<Record<Kind, number>>>;
export const baselinePath = 'scripts/test-harness-baseline.json';

// Files that may keep a pattern because nothing in them is a browser test. Exact (file, kind) pairs
// with the reason; a new direct launch or esbuild import anywhere else fails the ratchet.
export const allowList: Record<string, Partial<Record<Kind, string>>> = {
  'scripts/build-mode.test.ts': { esbuild: 'asserts the string "esbuild" returned by bundleMinify; imports nothing' },
  'scripts/bundle-integrity.test.ts': { esbuild: "runs Vite's esbuild CLI to minify a snippet for the bundle-integrity checks; no page bundle" },
  'src/providers/capabilities.test.ts': { esbuild: 'transformSync strips types and buildSync reads a metafile import graph in a node test; nothing is bundled for a page' },
};

export function countHarness(source: string): Partial<Record<Kind, number>> {
  return Object.fromEntries(Object.entries(rules).flatMap(([kind, pattern]) => {
    const count = [...source.matchAll(pattern)].length;
    return count ? [[kind, count]] : [];
  }));
}

export function inventory(directory = root): Inventory {
  const result: Inventory = {};
  for (const file of walkFiles(directory, name => name.endsWith('.test.ts') && !name.startsWith('src/test-utils/'))) {
    const counts = countHarness(readFileSync(join(directory, file), 'utf8'));
    for (const kind of Object.keys(allowList[file] ?? {}) as Kind[]) delete counts[kind];
    if (Object.keys(counts).length) result[file] = counts;
  }
  return result;
}

export function readBaseline(source: string): Inventory {
  const value: unknown = JSON.parse(source);
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), 'baseline must be an object');
  for (const [file, counts] of Object.entries(value)) {
    assert.ok(counts && typeof counts === 'object' && !Array.isArray(counts), `${file}: expected counts`);
    assert.ok(Object.keys(counts).length, `${file}: remove empty entries`);
    for (const [kind, count] of Object.entries(counts)) {
      assert.ok(Object.hasOwn(rules, kind) && typeof count === 'number' && Number.isSafeInteger(count) && count > 0, `${file}: invalid ${kind} count`);
    }
  }
  return value as Inventory;
}

// Helpers stay small and composable: a test that needs more composes the functions
// itself instead of getting another flag. Applies to src/test-utils/*.ts (not its
// player-scenarios, which are scenario code).
export const MAX_HELPER_LINES = 150;
export const MAX_OPTIONS = 4;

export function budgetViolations(file: string, source: string): string[] {
  const problems: string[] = [];
  const lines = source.split('\n').length - (source.endsWith('\n') ? 1 : 0);
  if (lines > MAX_HELPER_LINES) problems.push(`${file}: ${lines} lines exceeds ${MAX_HELPER_LINES}; split it or compose in the test`);
  for (const match of source.matchAll(/export interface (\w*Options)\s*\{([\s\S]*?)\n\}/g)) {
    const count = [...match[2].matchAll(/^\s+\w+\??:/gm)].length;
    if (count > MAX_OPTIONS) problems.push(`${file}: ${match[1]} has ${count} options, max ${MAX_OPTIONS}; compose the helper's pieces instead`);
  }
  return problems;
}

export function helperBudget(directory = root): string[] {
  return walkFiles(directory, name => /^src\/test-utils\/[^/]+\.ts$/.test(name) && !name.endsWith('.test.ts'))
    .flatMap(file => budgetViolations(file, readFileSync(join(directory, file), 'utf8')));
}

export const baselineFile: BaselineFile = { path: baselinePath, label: 'Test harness', read: readBaseline };

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const current = inventory();
  if (process.argv.includes('--update')) {
    const path = join(root, baselinePath);
    assertNoGrowth(current, readBaseline(readFileSync(path, 'utf8')));
    assertBaselineRatchet(current, root, Boolean(process.env.CI), baselineFile);
    writeFileSync(path, `${JSON.stringify(current, null, 2)}\n`);
  } else {
    console.log(JSON.stringify(current, null, 2));
  }
}
