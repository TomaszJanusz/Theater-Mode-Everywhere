import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Textual ratchet, including code serialized into page.evaluate strings. Timers
// and frame calls are counted conservatively (also fake clocks/watchdogs): new
// synchronization must use observable state or an explicitly controlled clock.
// Keep per-file/per-kind allowances exact; --update only accepts reductions.
const rules = {
  waitForTimeout: /\bwaitForTimeout\s*\(/g,
  timer: /\bsetTimeout\s*\(/g,
  sleep: /\b(?:sleep|delay)\s*\(/g,
  timerImport: /\bfrom\s*['"](?:node:)?timers(?:\/promises)?['"]/g,
  frame: /\brequestAnimationFrame\s*\(/g,
  retry: /\bretry\s*\(|\bretries\s*:\s*\d+|\b(?:for|while)\s*\([^)'"\n]*\b(?:attempt\w*|retr\w*)\b[^)'"\n]*\)/g,
};
type Kind = keyof typeof rules;
export type Inventory = Record<string, Partial<Record<Kind, number>>>;
export const root = fileURLToPath(new URL('..', import.meta.url));
export const baselinePath = 'scripts/test-determinism-baseline.json';

export function countWaits(source: string): Partial<Record<Kind, number>> {
  return Object.fromEntries(Object.entries(rules).flatMap(([kind, pattern]) => {
    const count = [...source.matchAll(pattern)].length;
    return count ? [[kind, count]] : [];
  }));
}

export function inventory(directory = root): Inventory {
  const result: Inventory = {};
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.') || ['node_modules', 'dist', 'coverage'].includes(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { walk(path); continue; }
      const file = relative(directory, path).replaceAll('\\', '/');
      if (!entry.isFile() || !(/\.test\.(?:ts|mjs)$/.test(file)
        || /^tools\/.*\.(?:[cm]?[jt]s)$/.test(file) || /^scripts\/smoke[^/]*\.ts$/.test(file))) continue;
      const counts = countWaits(readFileSync(path, 'utf8'));
      if (Object.keys(counts).length) result[file] = counts;
    }
  };
  walk(directory);
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

export function assertNoGrowth(current: Inventory, previous: Inventory): void {
  for (const [file, counts] of Object.entries(current)) {
    for (const [kind, count] of Object.entries(counts)) {
      const allowed = previous[file]?.[kind as Kind] ?? 0;
      assert.ok(count <= allowed, `${file}: ${kind} grew from ${allowed} to ${count}; replace the wait instead of raising the baseline`);
    }
  }
}

export function assertBaselineRatchet(current: Inventory): void {
  // CI checks out full history. The merge base excludes this branch's own edits;
  // the first introduction has no previous baseline to compare against.
  const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: root, encoding: 'utf8' }).trim();
  const files = execFileSync('git', ['ls-tree', '--name-only', base, '--', baselinePath], { cwd: root, encoding: 'utf8' });
  if (files.trim()) {
    const previous = execFileSync('git', ['show', `${base}:${baselinePath}`], { cwd: root, encoding: 'utf8' });
    assertNoGrowth(current, readBaseline(previous));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const current = inventory();
  if (process.argv.includes('--update')) {
    const path = join(root, baselinePath);
    assertNoGrowth(current, readBaseline(readFileSync(path, 'utf8')));
    assertBaselineRatchet(current);
    writeFileSync(path, `${JSON.stringify(current, null, 2)}\n`);
  } else {
    console.log(JSON.stringify(current, null, 2));
  }
}
