import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL('../.github/workflows/codeql.yml', import.meta.url), 'utf8');

test('codeql scans pull requests and pushes on main and dev', () => {
  for (const event of ['pull_request', 'push']) {
    const block = source.match(new RegExp(`^  ${event}:\\n    branches:\\n((?:      - .+\\n)+)`, 'm'));
    assert.ok(block, `${event} branches`);
    assert.deepEqual(block[1].trim().split('\n').map(line => line.replace(/^\s*- /, '')), ['main', 'dev']);
  }
});
