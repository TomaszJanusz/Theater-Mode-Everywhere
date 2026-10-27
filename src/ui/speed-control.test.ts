import assert from 'node:assert/strict';
import { it } from 'node:test';

import { stepPlaybackRate } from './speed-control';

it('steps along the speed menu and stops at either end', () => {
  assert.equal(stepPlaybackRate(1, 1), 1.25);
  assert.equal(stepPlaybackRate(1, -1), 0.75);
  assert.equal(stepPlaybackRate(2, 1), 2);
  assert.equal(stepPlaybackRate(0.25, -1), 0.25);
});

it('moves a host rate off the menu to the nearest level in the pressed direction', () => {
  assert.equal(stepPlaybackRate(1.1, 1), 1.25);
  assert.equal(stepPlaybackRate(1.1, -1), 1);
  assert.equal(stepPlaybackRate(3, -1), 2);
  assert.equal(stepPlaybackRate(3, 1), 3, 'a faster host rate is never lowered by speeding up');
});
