import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { PROVIDER_CAPABILITIES } from '../../src/providers/capabilities';

const SMOKE_DIR = new URL('./', import.meta.url);

/** Declared AutoTheater, proven by the dedicated installed fixtures in `auto-theater.ts` instead of the shared helper. */
const COVERED_ELSEWHERE = new Set(['youtube']);
/**
 * Legacy bundled integrations with no installed provider smoke yet. Add the shared helper when one gets a
 * smoke case, then delete its entry: the list may only shrink.
 */
const KNOWN_GAPS = new Set(['disney']);

function coveredByHelper(): Set<string> {
  const covered = new Set<string>();
  for (const file of readdirSync(SMOKE_DIR)) {
    if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue;
    const source = readFileSync(new URL(file, SMOKE_DIR), 'utf8');
    for (const match of source.matchAll(/assertAutoTheaterEntry\(\s*page,\s*context,\s*'(\w+)'/g)) covered.add(match[1]);
  }
  return covered;
}

describe('provider AutoTheater smoke coverage', () => {
  const declared = PROVIDER_CAPABILITIES.filter(row => row.capabilities.autoTheater.status === 'yes').map(row => row.id as string);

  it('runs the installed AutoTheater assertion for every provider that declares AutoTheater', () => {
    const covered = coveredByHelper();
    const missing = declared.filter(id => !covered.has(id) && !COVERED_ELSEWHERE.has(id) && !KNOWN_GAPS.has(id));
    assert.deepEqual(missing, [], `add assertAutoTheaterEntry to the provider's installed smoke: ${missing.join(', ')}`);
  });

  it('keeps the known-gap list to providers that still lack the assertion', () => {
    const covered = coveredByHelper();
    for (const id of KNOWN_GAPS) {
      assert.ok(declared.includes(id), `${id} no longer declares AutoTheater: remove it from KNOWN_GAPS`);
      assert.ok(!covered.has(id), `${id} is covered now: remove it from KNOWN_GAPS`);
    }
    for (const id of covered) assert.ok(declared.includes(id), `${id} does not declare AutoTheater`);
  });
});
