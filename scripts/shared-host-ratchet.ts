import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { currentInventory, KINDS, SERVICES, sortInventory, type Inventory, type Kind } from './shared-host-detector';
import { assertBaselineRatchet, root, type BaselineFile } from './test-determinism';

const baselinePath = 'config/shared-host-baseline.json';

const cellsOf = (inventory: Inventory): Map<string, number> => {
  const cells = new Map<string, number>();
  for (const [service, dirs] of Object.entries(inventory)) {
    for (const [dir, kinds] of Object.entries(dirs)) {
      for (const [kind, count] of Object.entries(kinds)) cells.set(`${service} ${dir} ${kind}`, count);
    }
  }
  return cells;
};

export const totalOf = (inventory: Inventory): number => [...cellsOf(inventory).values()].reduce((sum, count) => sum + count, 0);

// Each service/directory/kind cell only moves down. Growth fails; so does an improvement
// until the baseline is lowered (`pnpm check:shared-hosts --update`), so a gain cannot drift
// back. Moving a reference to another directory grows that cell and fails like any new one.
export function compareInventory(current: Inventory, baseline: Inventory): { grown: string[]; improved: string[] } {
  const now = cellsOf(current);
  const allowed = cellsOf(baseline);
  const grown: string[] = [];
  const improved: string[] = [];
  for (const cell of [...new Set([...now.keys(), ...allowed.keys()])].sort()) {
    const after = now.get(cell) ?? 0;
    const before = allowed.get(cell) ?? 0;
    if (after > before) grown.push(`${cell} grew from ${before} to ${after}`);
    else if (after < before) improved.push(`${cell} dropped from ${before} to ${after}`);
  }
  return { grown, improved };
}

export function assertNoGrowth(current: Inventory, baseline: Inventory, { allowImprovement = false } = {}): void {
  const { grown, improved } = compareInventory(current, baseline);
  assert.deepEqual(grown, [], `${grown.join('\n')}\nHost knowledge belongs in the provider (docs/player-provider-contracts.md); shared code may not gain more.`);
  if (!allowImprovement) assert.deepEqual(improved, [], `${improved.join('\n')}\nLock in the improvement with: pnpm check:shared-hosts --update`);
}

export function readBaseline(source: string): Inventory {
  const value: unknown = JSON.parse(source);
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), 'baseline must be an object');
  for (const [service, dirs] of Object.entries(value)) {
    assert.ok((SERVICES as readonly string[]).includes(service), `unknown service ${service}`);
    for (const [dir, kinds] of Object.entries(dirs as object)) {
      for (const [kind, count] of Object.entries(kinds as object)) {
        assert.ok((KINDS as readonly string[]).includes(kind as Kind), `${service} ${dir}: unknown kind ${kind}`);
        assert.ok(Number.isSafeInteger(count) && count > 0, `${service} ${dir} ${kind}: counts are positive integers`);
      }
    }
  }
  return sortInventory(value as Inventory);
}

const summary = (inventory: Inventory): string => Object.entries(inventory)
  .map(([service, dirs]) => `${service} ${totalOf({ [service]: dirs })}`).join(', ');

/** The ratchet's cells in the two-level shape the base-ref comparison shares with the test baselines. */
export const flattenInventory = (inventory: Inventory): Record<string, Partial<Record<Kind, number>>> =>
  Object.fromEntries(Object.entries(inventory).flatMap(([service, dirs]) => Object.entries(dirs).map(([dir, kinds]) => [`${service} ${dir}`, kinds])));

/** Compared with the PR's base branch too, so editing the baseline up cannot admit growth. */
export const baselineFile: BaselineFile = {
  path: baselinePath,
  label: 'Shared host',
  remedy: 'move the host knowledge into its provider',
  read: source => flattenInventory(readBaseline(source)),
};

export function main(args = process.argv.slice(2)): void {
  const current = currentInventory();
  const baseline = readBaseline(readFileSync(baselinePath, 'utf8'));
  const update = args.includes('--update');
  assertNoGrowth(current, baseline, { allowImprovement: update });
  assertBaselineRatchet(flattenInventory(current), root, Boolean(process.env.CI), baselineFile);
  if (update) writeFileSync(baselinePath, `${JSON.stringify(current, null, 2)}\n`);
  console.log(`Shared host ratchet passed: ${totalOf(current)} host-specific references in shared code (${summary(current)})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); } catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
}
