import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { timelineTickPositions } from './timeline-ticks';
import type { TimelineMarker } from './types';

const marker = (start: number, end: number): TimelineMarker => ({ start, end, color: '#fff', opacity: 1, labelKey: 'x' });

describe('timelineTickPositions', () => {
  it('ticks both segment boundaries and chapter starts, sorted', () => {
    assert.deepEqual(timelineTickPositions([marker(.5, .6), marker(.1, .2)], [.3]), [.1, .2, .3, .5, .6]);
  });
  it('merges adjacent and overlapping boundaries and chapters on the same position', () => {
    assert.deepEqual(timelineTickPositions([marker(.1, .2), marker(.2, .3), marker(.3 + 5e-5, .4)], [.2, .4]), [.1, .2, .3, .4]);
  });
  it('emits one tick for a point marker and none on the track edges', () => {
    assert.deepEqual(timelineTickPositions([marker(.6, .6), marker(0, .25), marker(.9, 1)], [0]), [.25, .6, .9]);
  });
  it('ignores non-finite positions', () => {
    assert.deepEqual(timelineTickPositions([marker(Number.NaN, .5)], [Number.POSITIVE_INFINITY]), [.5]);
  });
});
