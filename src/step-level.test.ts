import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { stepLevel } from './step-level';

describe('stepLevel', () => {
  const levels = ['a', 'b', 'c'] as const;

  it('steps one place and stops at both ends', () => {
    assert.equal(stepLevel(levels, 'b', 1), 'c');
    assert.equal(stepLevel(levels, 'c', 1), 'c');
    assert.equal(stepLevel(levels, 'b', -1), 'a');
    assert.equal(stepLevel(levels, 'a', -1), 'a');
  });

  it('falls back to the first level for a value outside the list', () => {
    assert.equal(stepLevel(levels, 'z' as 'a', 1), 'a');
  });
});
