import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { baseRef } from './base-ref.mjs';

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

/** Repository files accepted by `accept` (a posix path relative to `directory`), skipping generated trees. */
export function walkFiles(directory: string, accept: (file: string) => boolean): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.') || ['node_modules', 'dist', 'coverage'].includes(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { walk(path); continue; }
      const file = relative(directory, path).replaceAll('\\', '/');
      if (entry.isFile() && accept(file)) found.push(file);
    }
  };
  walk(directory);
  return found;
}

export function inventory(directory = root): Inventory {
  const result: Inventory = {};
  const scanned = (file: string) => /\.test\.(?:ts|mjs)$/.test(file)
    || /^src\/test-utils\/.*\.ts$/.test(file) || /^tools\/.*\.(?:[cm]?[jt]s)$/.test(file) || /^scripts\/(?:smoke[^/]*|smoke\/.*)\.ts$/.test(file);
  for (const file of walkFiles(directory, scanned)) {
    const counts = countWaits(readFileSync(join(directory, file), 'utf8'));
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

export function assertNoGrowth(
  current: Record<string, Partial<Record<string, number>>>,
  previous: Record<string, Partial<Record<string, number>>>,
  remedy = 'replace the wait'
): void {
  for (const [file, counts] of Object.entries(current)) {
    for (const [kind, count] of Object.entries(counts)) {
      const allowed = previous[file]?.[kind] ?? 0;
      assert.ok((count ?? 0) <= allowed, `${file}: ${kind} grew from ${allowed} to ${count}; ${remedy} instead of raising the baseline`);
    }
  }
}

/** Where a ratcheted inventory is recorded and how an older revision of it is parsed. */
export interface BaselineFile { path: string; label: string; remedy?: string; read(source: string): Record<string, Partial<Record<string, number>>> }

export function assertBaselineRatchet(
  current: Record<string, Partial<Record<string, number>>>,
  directory = root,
  ci = Boolean(process.env.CI),
  baseline: BaselineFile = { path: baselinePath, label: 'Determinism', read: readBaseline }
): void {
  const baseName = baseRef();
  const ref = spawnSync('git', ['rev-parse', '--verify', `refs/remotes/${baseName}`], { cwd: directory, encoding: 'utf8' });
  if (ref.status !== 0) {
    const message = `${baseline.label} baseline history check requires ${baseName}; run git fetch origin (CI requires full history).`;
    assert.ok(!ci, message);
    console.warn(`${message} Skipping only the local history comparison; inventory checks still run.`);
    return;
  }
  // CI checks out full history. The merge base excludes this branch's own edits;
  // the first introduction has no previous baseline to compare against.
  const base = execFileSync('git', ['merge-base', 'HEAD', baseName], { cwd: directory, encoding: 'utf8' }).trim();
  const files = execFileSync('git', ['ls-tree', '--name-only', base, '--', baseline.path], { cwd: directory, encoding: 'utf8' });
  if (files.trim()) {
    const previous = execFileSync('git', ['show', `${base}:${baseline.path}`], { cwd: directory, encoding: 'utf8' });
    assertNoGrowth(current, baseline.read(previous), baseline.remedy);
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
