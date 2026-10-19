import assert from 'node:assert/strict';
import { test } from 'node:test';
import { baseRef } from './base-ref.mjs';

test('base ref follows the pull request base branch and defaults to origin/main', () => {
  assert.equal(baseRef({ GITHUB_BASE_REF: 'dev' }), 'origin/dev');
  assert.equal(baseRef({ GITHUB_BASE_REF: 'main' }), 'origin/main');
  assert.equal(baseRef({ GITHUB_BASE_REF: '' }), 'origin/main');
  assert.equal(baseRef({}), 'origin/main');
  assert.equal(baseRef({ GITHUB_BASE_REF: 'x; rm -rf /' }), 'origin/main');
});
