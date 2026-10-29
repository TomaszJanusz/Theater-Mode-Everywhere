import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { manualClock } from '../../.storybook/manual-clock';

import { createSeekHold, SEEK_HOLD_DELAY_MS } from './seek-hold';

function setup() {
  const clock = manualClock();
  const calls: string[] = [];
  const hold = createSeekHold({
    clock,
    tap: () => calls.push('tap'),
    startHold: () => calls.push('start'),
    endHold: () => calls.push('end')
  });
  return { hold, calls, clock };
}

describe('seek hold', () => {
  it('seeks as the key goes down, and a short press does nothing more', () => {
    const { hold, calls, clock } = setup();
    hold.press('ArrowRight');
    assert.deepEqual(calls, ['tap']);
    clock.advance(SEEK_HOLD_DELAY_MS - 1);
    hold.release('ArrowRight');
    clock.advance(SEEK_HOLD_DELAY_MS);
    assert.deepEqual(calls, ['tap'], 'a released tap leaves no timer to start a hold');
    assert.equal(clock.pending, 0);
  });

  it('holds once the key outlasts the delay, until released, without seeking again', () => {
    const { hold, calls, clock } = setup();
    hold.press('ArrowRight');
    clock.advance(SEEK_HOLD_DELAY_MS);
    assert.deepEqual(calls, ['tap', 'start']);
    clock.advance(5_000);
    hold.release('ArrowRight');
    assert.deepEqual(calls, ['tap', 'start', 'end']);
  });

  it('ignores releases of other keys', () => {
    const { hold, calls, clock } = setup();
    hold.press('ArrowRight');
    hold.release('ShiftLeft');
    clock.advance(SEEK_HOLD_DELAY_MS);
    hold.release('ShiftLeft');
    assert.deepEqual(calls, ['tap', 'start']);
    hold.release('ArrowRight');
    assert.deepEqual(calls, ['tap', 'start', 'end']);
  });

  it('cancels a pending press or an active hold without seeking; repeating it is harmless', () => {
    const { hold, calls, clock } = setup();
    hold.press('ArrowRight');
    hold.cancel();
    clock.advance(SEEK_HOLD_DELAY_MS);
    assert.deepEqual(calls, ['tap']);
    assert.equal(clock.pending, 0);

    hold.press('ArrowRight');
    clock.advance(SEEK_HOLD_DELAY_MS);
    hold.cancel();
    hold.cancel();
    hold.release('ArrowRight');
    assert.deepEqual(calls, ['tap', 'tap', 'start', 'end']);
  });

  it('ends a press whose release was lost before the next press seeks', () => {
    const { hold, calls, clock } = setup();
    hold.press('ArrowRight');
    hold.press('ArrowRight');
    assert.deepEqual(calls, ['tap', 'tap']);
    clock.advance(SEEK_HOLD_DELAY_MS);
    assert.deepEqual(calls, ['tap', 'tap', 'start'], 'only the latest press can start a hold');
    hold.press('ArrowRight');
    assert.deepEqual(calls, ['tap', 'tap', 'start', 'end', 'tap']);
  });
});
