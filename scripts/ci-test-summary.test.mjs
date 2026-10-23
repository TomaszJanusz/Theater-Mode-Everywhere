import assert from 'node:assert/strict';
import { test } from 'node:test';

import { summarize } from './ci-test-summary.mjs';

test('reports slow tests and failed tests from Node JUnit output', () => {
  const cases = Array.from({ length: 17 }, (_, index) => {
    const failure = index === 0 ? '<failure message="failed">expected</failure>' : '';
    return `<testcase name="case ${index}" file="/repo/fixture.test.mjs" time="${index + 1}">${failure}</testcase>`;
  }).join('');
  const report = summarize([`<testsuites>${cases}</testsuites>`]);
  assert.match(report, /17 tests reported; 1 failed/);
  assert.match(report, /case 16.*17\.000/);
  assert.match(report, /#### Failures[\s\S]*case 0.*1\.000/);
  assert.equal(report.split('#### Failures')[0].includes('case 0'), false);
});
