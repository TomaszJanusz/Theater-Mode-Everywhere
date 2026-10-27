import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createSeekHold, SEEK_HOLD_DELAY_MS } from './seek-hold';
import type { UiClock } from './ui-clock';

function manualClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; handler: () => void }>();
  const clock: UiClock = {
    setTimeout: (handler, delayMs) => {
      const id = nextId++;
      timers.set(id, { at: now + delayMs, handler });
      return id;
    },
    clearTimeout: (id) => {
      if (id !== undefined) timers.delete(id);
    }
  };
  const advance = (ms: number) => {
    now += ms;
    for (const [id, timer] of [...timers]) {
      if (timer.at > now) continue;
      timers.delete(id);
      timer.handler();
    }
  };
  return { clock, advance, pending: () => timers.size };
}

function setup() {
  const { clock, advance, pending } = manualClock();
  const calls: string[] = [];
  const hold = createSeekHold({
    clock,
    tap: () => calls.push('tap'),
    startHold: () => calls.push('start'),
    endHold: () => calls.push('end')
  });
  return { hold, calls, advance, pending };
}

describe('seek hold', () => {
  it('seeks once on a short press, on release', () => {
    const { hold, calls, advance, pending } = setup();
    hold.press('ArrowRight');
    advance(SEEK_HOLD_DELAY_MS - 1);
    assert.deepEqual(calls, []);
    hold.release('ArrowRight');
    assert.deepEqual(calls, ['tap']);
    advance(SEEK_HOLD_DELAY_MS);
    assert.deepEqual(calls, ['tap'], 'a released tap leaves no timer to start a hold');
    assert.equal(pending(), 0);
  });

  it('holds instead of seeking once the key outlasts the delay, until released', () => {
    const { hold, calls, advance } = setup();
    hold.press('ArrowRight');
    advance(SEEK_HOLD_DELAY_MS);
    assert.deepEqual(calls, ['start']);
    advance(5_000);
    hold.release('ArrowRight');
    assert.deepEqual(calls, ['start', 'end']);
  });

  it('ignores releases of other keys', () => {
    const { hold, calls, advance } = setup();
    hold.press('ArrowRight');
    hold.release('ShiftLeft');
    advance(SEEK_HOLD_DELAY_MS);
    hold.release('ShiftLeft');
    assert.deepEqual(calls, ['start']);
    hold.release('ArrowRight');
    assert.deepEqual(calls, ['start', 'end']);
  });

  it('cancels without seeking and ends an active hold; repeating it is harmless', () => {
    const { hold, calls, advance, pending } = setup();
    hold.press('ArrowRight');
    hold.cancel();
    advance(SEEK_HOLD_DELAY_MS);
    assert.deepEqual(calls, []);
    assert.equal(pending(), 0);

    hold.press('ArrowRight');
    advance(SEEK_HOLD_DELAY_MS);
    hold.cancel();
    hold.cancel();
    hold.release('ArrowRight');
    assert.deepEqual(calls, ['start', 'end']);
  });

  it('completes a press whose release was lost before starting the next one', () => {
    const { hold, calls, advance } = setup();
    hold.press('ArrowRight');
    hold.press('ArrowRight');
    assert.deepEqual(calls, ['tap']);
    advance(SEEK_HOLD_DELAY_MS);
    hold.press('ArrowRight');
    assert.deepEqual(calls, ['tap', 'start', 'end']);
  });
});
