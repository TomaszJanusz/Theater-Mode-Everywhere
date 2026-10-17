import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createPictureClickGate, PICTURE_DOUBLE_CLICK_MS } from './picture-click';

function setup() {
  let now = 0;
  let nextId = 1;
  const queue = new Map<number, { at: number; fn: () => void }>();
  const calls: string[] = [];
  const gate = createPictureClickGate(
    {
      commit: () => calls.push('toggle'),
      fullscreen: () => calls.push('fullscreen'),
      preview: () => calls.push('preview'),
      revoke: () => calls.push('revoke')
    },
    {
      set: (fn, ms) => { queue.set(nextId, { at: now + ms, fn }); return nextId++; },
      clear: id => { queue.delete(id as number); }
    }
  );
  const advance = (ms: number) => {
    now += ms;
    for (const [id, t] of [...queue]) if (t.at <= now) { queue.delete(id); t.fn(); }
  };
  return { gate, calls, advance, pending: () => queue.size };
}

describe('picture click gate', () => {
  it('previews at once and toggles once after the window', () => {
    const { gate, calls, advance } = setup();
    gate.click();
    assert.deepEqual(calls, ['preview']);
    advance(PICTURE_DOUBLE_CLICK_MS - 1);
    assert.deepEqual(calls, ['preview']);
    advance(1);
    assert.deepEqual(calls, ['preview', 'toggle']);
  });

  it('turns click, click, dblclick into fullscreen only and withdraws the preview', () => {
    const { gate, calls, advance } = setup();
    gate.click();
    advance(100);
    gate.click();
    gate.doubleClick();
    advance(1000);
    assert.deepEqual(calls, ['preview', 'revoke', 'fullscreen']);
  });

  it('does not drop a click pair when the browser sends no dblclick', () => {
    const { gate, calls, advance } = setup();
    gate.click();
    advance(80);
    gate.click();
    assert.deepEqual(calls, ['preview']);
    advance(0);
    advance(1);
    assert.deepEqual(calls, ['preview', 'toggle']);
  });

  it('commits a slow pair first and still toggles fullscreen once for its dblclick', () => {
    const { gate, calls, advance } = setup();
    gate.click();
    advance(PICTURE_DOUBLE_CLICK_MS + 50);
    gate.click();
    gate.doubleClick();
    advance(1000);
    assert.deepEqual(calls, ['preview', 'toggle', 'preview', 'revoke', 'fullscreen']);
  });

  it('treats a second click exactly at the window edge as a new single click', () => {
    const { gate, calls, advance } = setup();
    gate.click();
    advance(PICTURE_DOUBLE_CLICK_MS);
    gate.click();
    advance(PICTURE_DOUBLE_CLICK_MS);
    assert.deepEqual(calls, ['preview', 'toggle', 'preview', 'toggle']);
  });

  it('drops a pending click on cancel, repeatedly, leaving no timers', () => {
    const { gate, calls, advance, pending } = setup();
    gate.click();
    gate.cancel();
    gate.cancel();
    advance(1000);
    assert.equal(pending(), 0);
    assert.deepEqual(calls, ['preview', 'revoke']);
  });

  it('works without preview hooks', () => {
    const calls: string[] = [];
    const gate = createPictureClickGate(
      { commit: () => calls.push('toggle'), fullscreen: () => calls.push('fullscreen') },
      { set: fn => { fn(); return 1; }, clear: () => {} }
    );
    gate.click();
    gate.cancel();
    assert.deepEqual(calls, ['toggle']);
  });
});
