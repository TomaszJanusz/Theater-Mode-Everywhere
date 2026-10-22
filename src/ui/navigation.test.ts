import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { nextFocusIndex, type FocusRect } from './navigation';

const box = (left: number, top: number, width = 32, height = 32): FocusRect => ({ left, top, right: left + width, bottom: top + height });

describe('navigation graph', () => {
  // A bar: a scrubber across the top, then a row of buttons.
  const scrubber = box(0, 0, 400, 16);
  const row = [box(0, 40), box(40, 40), box(80, 40), box(300, 40)];
  const items = [scrubber, ...row];

  it('moves along a row to its nearest neighbour and stops at the ends', () => {
    assert.equal(nextFocusIndex(row[1], items, 'right'), 3);
    assert.equal(nextFocusIndex(row[1], items, 'left'), 1);
    assert.equal(nextFocusIndex(row[0], items, 'left'), -1);
    assert.equal(nextFocusIndex(row[3], items, 'right'), -1);
  });

  it('does not jump to another row sideways', () => {
    assert.equal(nextFocusIndex(scrubber, items, 'right'), -1);
    assert.equal(nextFocusIndex(scrubber, items, 'left'), -1);
  });

  it('goes up to the nearest row and down again, and reports nothing below the last row', () => {
    assert.equal(nextFocusIndex(row[2], items, 'up'), 0);
    assert.equal(nextFocusIndex(row[2], items, 'down'), -1);
    assert.equal(nextFocusIndex(row[3], items, 'up'), 0);
  });

  it('picks the row item in line with where focus came from', () => {
    // The scrubber's centre is at 200: of the buttons below, the third (centre 96) is closest to that line.
    assert.equal(nextFocusIndex(scrubber, items, 'down'), 3);
  });

  it('takes the nearest row, not a farther one in line', () => {
    const menu = [box(0, 0, 300), box(0, 40, 300), box(200, 80, 32), box(250, 80, 32), box(0, 120, 300)];
    assert.equal(nextFocusIndex(menu[0], menu, 'down'), 1);
    assert.equal(nextFocusIndex(menu[1], menu, 'down'), 2);
    assert.equal(nextFocusIndex(menu[4], menu, 'up'), 2);
    assert.equal(nextFocusIndex(menu[2], menu, 'right'), 3);
    assert.equal(nextFocusIndex(menu[3], menu, 'left'), 2);
  });

  it('treats left and right as screen directions, with no special case for right-to-left', () => {
    const mirrored = [box(300, 0), box(260, 0), box(220, 0)];
    assert.equal(nextFocusIndex(mirrored[0], mirrored, 'left'), 1);
    assert.equal(nextFocusIndex(mirrored[2], mirrored, 'right'), 1);
  });

  it('ignores candidates at the same place and an empty field', () => {
    assert.equal(nextFocusIndex(row[0], [row[0]], 'right'), -1);
    assert.equal(nextFocusIndex(row[0], [], 'up'), -1);
  });
});
