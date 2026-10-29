import assert from 'node:assert/strict';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { resolveBundleBuildMode } from './build-mode';
import { assertBaselineRatchet, root, type BaselineFile } from './test-determinism';

const baselinePath = 'config/bundle-size-baseline.json';
const defaultDirs = ['dist/chrome-unpacked', 'dist/firefox-unpacked'];

/** The shared bundles every host pays for, whatever service it shows. */
export const SHARED_BUNDLES = ['content.js', 'mainWorld.js'] as const;
export type BundleSizes = Record<(typeof SHARED_BUNDLES)[number], number>;

/**
 * Slack around the recorded size, in bytes. Production output is byte-for-byte deterministic (the same
 * lockfile gives the same bytes on every build, and both browsers ship identical files), so none of it is
 * measurement noise. It only lets a one-line fix or a toolchain bump pass without touching the baseline,
 * while staying under the smallest real addition: a 66-94 line provider-contract change minifies to 2-3 KB.
 * The slack is total, not per change: the baseline is not raised by growth, so it cannot accumulate.
 */
export const TOLERANCE_BYTES = 1024;

export function compareSizes(current: BundleSizes, baseline: BundleSizes, tolerance = TOLERANCE_BYTES): { grown: string[]; improved: string[] } {
  const grown: string[] = [];
  const improved: string[] = [];
  for (const file of SHARED_BUNDLES) {
    const delta = current[file] - baseline[file];
    if (delta > tolerance) grown.push(`${file} grew by ${delta} B to ${current[file]} B (recorded ${baseline[file]} B, tolerance ${tolerance} B)`);
    else if (delta < -tolerance) improved.push(`${file} shrank by ${-delta} B to ${current[file]} B (recorded ${baseline[file]} B)`);
  }
  return { grown, improved };
}

export function assertSizes(current: BundleSizes, baseline: BundleSizes, { allowImprovement = false } = {}): void {
  const { grown, improved } = compareSizes(current, baseline);
  assert.deepEqual(grown, [], `${grown.join('\n')}\nEvery host loads these bundles: move the code into the provider that needs it, or justify the growth to the maintainer.`);
  if (!allowImprovement) assert.deepEqual(improved, [], `${improved.join('\n')}\nLock in the improvement with: pnpm check:bundle-size --update`);
}

export function readBaseline(source: string): BundleSizes {
  const value: unknown = JSON.parse(source);
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), 'baseline must be an object');
  assert.deepEqual(Object.keys(value).sort(), [...SHARED_BUNDLES].sort(), `baseline must list exactly ${SHARED_BUNDLES.join(', ')}`);
  for (const file of SHARED_BUNDLES) {
    const bytes = (value as Record<string, unknown>)[file];
    assert.ok(typeof bytes === 'number' && Number.isSafeInteger(bytes) && bytes > 0, `${file}: bytes must be a positive integer`);
  }
  return value as BundleSizes;
}

export const measureSizes = (dir: string): BundleSizes => Object.fromEntries(SHARED_BUNDLES.map(file => [file, statSync(join(dir, file)).size])) as BundleSizes;

/** Updating only ever lowers the record; raising it is a hand edit that a reviewer sees. */
export const lowerBaseline = (current: BundleSizes, baseline: BundleSizes): BundleSizes =>
  Object.fromEntries(SHARED_BUNDLES.map(file => [file, Math.min(current[file], baseline[file])])) as BundleSizes;

/** Sizes as `{ file: { bytes } }`, the shape the base-ref comparison shares with the test baselines. */
export const sizeCells = (sizes: BundleSizes, slack = 0): Record<string, { bytes: number }> =>
  Object.fromEntries(SHARED_BUNDLES.map(file => [file, { bytes: sizes[file] + slack }]));

/** Compared with the PR's base branch too: a build may exceed the base's record only by the tolerance, whatever this PR's baseline says. */
export const baselineFile: BaselineFile = {
  path: baselinePath,
  label: 'Bundle size',
  remedy: 'move the code into the provider that needs it',
  read: source => sizeCells(readBaseline(source), TOLERANCE_BYTES),
};

/** The ratchet applies to the minified production bundles; a diagnostic build is unminified by design. */
export function assertBundleSizes(dirs: string[], { update = false } = {}): void {
  if (resolveBundleBuildMode() !== 'production') {
    console.log('Bundle size ratchet skipped: TME_BUILD=diagnostic output is not minified.');
    return;
  }
  const baseline = readBaseline(readFileSync(baselinePath, 'utf8'));
  for (const dir of dirs) {
    const current = measureSizes(resolve(dir));
    assertSizes(current, baseline, { allowImprovement: update });
    assertBaselineRatchet(sizeCells(current), root, Boolean(process.env.CI), baselineFile);
    const sizes = SHARED_BUNDLES.map(file => `${file} ${current[file]} B`).join(', ');
    console.log(`Bundle size ratchet passed for ${dir}: ${sizes}`);
  }
  if (update) writeFileSync(baselinePath, `${JSON.stringify(lowerBaseline(measureSizes(resolve(dirs[0])), baseline), null, 2)}\n`);
}

export function main(args = process.argv.slice(2)): void {
  const dirs = args.filter(arg => !arg.startsWith('--'));
  assertBundleSizes(dirs.length ? dirs : defaultDirs, { update: args.includes('--update') });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); } catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
}
