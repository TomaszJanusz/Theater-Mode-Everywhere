import assert from 'node:assert/strict';
import test from 'node:test';

import { compareKnown, readLimit } from './boundaries-ratchet.mjs';

const violation = (from, to, name = 'providers-do-not-import-other-providers') => ({ from, to, rule: { name, severity: 'error' } });
const a = violation('src/providers/a/x.ts', 'src/providers/b/y.ts');
const b = violation('src/providers/c/x.ts', 'src/providers/d/y.ts');

test('known boundary violations may be paid off but not added', () => {
  assert.deepEqual(compareKnown([a, b], [a, b], 2).problems, []);
  assert.match(compareKnown([a, b], [a], 1).problems.join('\n'), /new violation/);
  assert.match(compareKnown([a], [a, b], 2).problems.join('\n'), /stale known violation/);
  // Hand-adding an entry for a live violation is caught by the recorded limit.
  assert.match(compareKnown([a, b], [a, b], 1).problems.join('\n'), /grew to 2/);
  assert.match(compareKnown([a], [a], 3).problems.join('\n'), /lower it/);
  assert.deepEqual(compareKnown([a], [a, b], 2).remaining, [a]);
});

test('the recorded limit is validated', () => {
  assert.equal(readLimit('{"knownViolations":0}'), 0);
  assert.throws(() => readLimit('{"knownViolations":-1}'));
  assert.throws(() => readLimit('{}'));
});
