import assert from 'node:assert/strict';
import { it } from 'node:test';

import { createLiveResizeBudget, type LiveResizeBudget } from './live-resize-budget';

function feed(budget: LiveResizeBudget, frames: ReadonlyArray<[number, boolean]>): boolean[] {
  return frames.map(([interval, wrote]) => { budget.frame(interval, wrote); return budget.live; });
}

it('stays live while writing frames fit the budget, including the odd slow one', () => {
  const budget = createLiveResizeBudget();
  const live = feed(budget, [[16.7, false], [17, true], [16.6, true], [90, true], [17, true], [16.8, true], [40, true], [16.7, true], [17, true]]);
  assert.deepEqual(live, Array(9).fill(true));
});

it('falls back once the median of the last six writing frames is over budget, not before', () => {
  const budget = createLiveResizeBudget();
  const live = feed(budget, [[16.7, false], [60, true], [70, true], [55, true], [80, true], [65, true]]);
  assert.deepEqual(live, [true, true, true, true, true, true], 'five slow writes are not yet a window');
  budget.frame(75, true);
  assert.equal(budget.live, false);
});

it('ignores frames without a write when judging, and learns a slow display from them', () => {
  // A 30 Hz display: plain frames take 33 ms, so 33 ms writes are within its budget (1.5 × 33).
  const budget = createLiveResizeBudget();
  feed(budget, [[33.4, false], [33.3, false]]);
  feed(budget, Array.from({ length: 8 }, () => [34, true] as [number, boolean]));
  assert.equal(budget.live, true);
  // Without plain frames it assumes 60 Hz, and the same writes are over the 24 ms floor.
  const unknown = createLiveResizeBudget();
  feed(unknown, Array.from({ length: 6 }, () => [34, true] as [number, boolean]));
  assert.equal(unknown.live, false);
  // Many cheap plain frames never move it out of live on their own.
  const idle = createLiveResizeBudget();
  feed(idle, Array.from({ length: 50 }, () => [16.7, false] as [number, boolean]));
  assert.equal(idle.live, true);
});

it('returns to live after two consecutive writes within budget, with a fresh window', () => {
  const budget = createLiveResizeBudget();
  feed(budget, Array.from({ length: 6 }, () => [100, true] as [number, boolean]));
  assert.equal(budget.live, false);
  // Plain frames while previewing are cheap and prove nothing about writes.
  feed(budget, Array.from({ length: 20 }, () => [16.7, false] as [number, boolean]));
  assert.equal(budget.live, false);
  feed(budget, [[18, true], [120, true], [19, true]]);
  assert.equal(budget.live, false, 'one good write between slow ones is not a recovery');
  budget.frame(20, true);
  assert.equal(budget.live, true);
  // The old slow frames are gone: it takes a full slow window to fall back again.
  feed(budget, Array.from({ length: 5 }, () => [100, true] as [number, boolean]));
  assert.equal(budget.live, true);
  budget.frame(100, true);
  assert.equal(budget.live, false);
});

it('asks for twice as many good writes after each fallback, up to eight, so a borderline host does not flip back and forth', () => {
  const budget = createLiveResizeBudget();
  const slowWindow = () => feed(budget, Array.from({ length: 6 }, () => [33.3, true] as [number, boolean]));
  const goodUntilLive = () => {
    let writes = 0;
    while (!budget.live && writes < 20) { budget.frame(16.7, true); writes++; }
    return writes;
  };
  slowWindow();
  assert.equal(goodUntilLive(), 2);
  slowWindow();
  assert.equal(goodUntilLive(), 4);
  slowWindow();
  assert.equal(goodUntilLive(), 8);
  slowWindow();
  assert.equal(goodUntilLive(), 8);
});

it('ignores intervals that are not positive and finite', () => {
  const budget = createLiveResizeBudget();
  feed(budget, [[0, true], [-5, true], [Number.NaN, true], [Infinity, true], [0, true], [0, true], [0, true]]);
  assert.equal(budget.live, true);
});
