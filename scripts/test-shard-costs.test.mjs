import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCosts, vitestSeconds } from './test-shard-costs.mjs';

test('a file measured in several runs takes the median and the table is sorted', () => {
  const costs = buildCosts([{ 'b.test.ts': 10, 'a.test.ts': 2 }, { 'b.test.ts': 30 }, { 'b.test.ts': 12.34 }], { 1: 40 });
  assert.deepEqual(costs, { files: { 'a.test.ts': 2, 'b.test.ts': 12.3 }, overhead: { 1: 40 } });
  assert.deepEqual(Object.keys(costs.files), ['a.test.ts', 'b.test.ts']);
  assert.deepEqual(buildCosts([{ 'a.test.ts': 1 }]), { files: { 'a.test.ts': 1 } });
});

test('Vitest component file times come from its JUnit suites', () => {
  const xml = `<testsuites name="vitest tests" tests="2" time="3.6">
    <testsuite name="src/a.component.test.ts" timestamp="2026-11-01T23:33:59.634Z" hostname="h" tests="1" time="0.528">
      <testcase classname="src/a.component.test.ts" name="x" time="0.526"></testcase>
    </testsuite>
    <testsuite name="src/b.component.test.ts" timestamp="t" hostname="h" tests="26" failures="0" time="3.102"></testsuite>
  </testsuites>`;
  assert.deepEqual(vitestSeconds(xml), { 'src/a.component.test.ts': 0.528, 'src/b.component.test.ts': 3.102 });
});
