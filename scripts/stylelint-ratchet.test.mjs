import assert from 'node:assert/strict';
import test from 'node:test';

import { assertNoGrowth, readBaseline } from './stylelint-ratchet.mjs';

test('CSS allowances can shrink but cannot grow by file or rule', () => {
  const baseline = readBaseline('{"src/ui/shadow.css":{"declaration-no-important":2}}');
  assert.doesNotThrow(() => assertNoGrowth({ 'src/ui/shadow.css': { 'declaration-no-important': 1 } }, baseline));
  assert.throws(() => assertNoGrowth({ 'src/ui/shadow.css': { 'declaration-no-important': 3 } }, baseline), /grew/);
  assert.throws(() => assertNoGrowth({ 'src/ui/shadow.css': { 'selector-disallowed-list': 1 } }, baseline), /grew/);
  assert.throws(() => assertNoGrowth({ 'src/ui/new.css': { 'declaration-no-important': 1 } }, baseline), /grew/);
});
