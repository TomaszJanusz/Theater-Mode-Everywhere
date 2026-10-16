import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createPictureDismissLatch, LEAVE_HINT_MS } from './picture-dismiss';

function setup() {
  let now = 0;
  const latch = createPictureDismissLatch(() => now);
  return { latch, tick: (ms: number) => { now += ms; } };
}

describe('picture dismiss latch', () => {
  it('lets a press that closes open chrome dismiss once, then the next click toggles', () => {
    const { latch } = setup();
    latch.press(true);
    assert.equal(latch.consume(), true);
    assert.equal(latch.consume(), false);
    latch.press(false);
    assert.equal(latch.consume(), false);
  });

  it('honours a popover leave right before the press', () => {
    const { latch, tick } = setup();
    latch.noteLeave();
    tick(LEAVE_HINT_MS);
    latch.press(false);
    assert.equal(latch.consume(), true);
  });

  it('does not let an old leave swallow a later unrelated click (skipped-click regression)', () => {
    const { latch, tick } = setup();
    latch.noteLeave();
    tick(LEAVE_HINT_MS + 1);
    latch.press(false);
    assert.equal(latch.consume(), false);
  });

  it('spends the leave hint on the first press, even when no click follows', () => {
    const { latch } = setup();
    latch.noteLeave();
    latch.press(false);
    latch.press(false);
    assert.equal(latch.consume(), false);
  });

  it('forgets a press whose click never arrived once the next press decides', () => {
    const { latch } = setup();
    latch.press(true);
    latch.press(false);
    assert.equal(latch.consume(), false);
  });

  it('clears everything on blur, key or elsewhere', () => {
    const { latch } = setup();
    latch.noteLeave();
    latch.clear();
    latch.press(false);
    assert.equal(latch.consume(), false);
    latch.press(true);
    latch.clear();
    assert.equal(latch.consume(), false);
  });
});
