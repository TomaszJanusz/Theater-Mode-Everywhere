import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createPictureClickGate, PICTURE_DOUBLE_CLICK_MS } from './picture-click';

function setup() {
  let now = 0;
  let nextId = 1;
  const queue = new Map<number, { at: number; fn: () => void }>();
  const calls: string[] = [];
  const gate = createPictureClickGate(
    () => calls.push('click'),
    () => calls.push('double'),
    {
      set: (fn, ms) => { queue.set(nextId, { at: now + ms, fn }); return nextId++; },
      clear: id => { queue.delete(id as number); }
    }
  );
  const advance = (ms: number) => {
    now += ms;
    for (const [id, t] of [...queue]) if (t.at <= now) { queue.delete(id); t.fn(); }
  };
  return { gate, calls, advance };
}

describe('picture click gate', () => {
  it('fires a lone click only after the double-click window', () => {
    const { gate, calls, advance } = setup();
    gate.click();
    advance(PICTURE_DOUBLE_CLICK_MS - 1);
    assert.deepEqual(calls, []);
    advance(1);
    assert.deepEqual(calls, ['click']);
  });

  it('turns click, click, dblclick into one double action with no play/pause', () => {
    const { gate, calls, advance } = setup();
    gate.click();
    advance(100);
    gate.click();
    gate.doubleClick();
    advance(1000);
    assert.deepEqual(calls, ['double']);
  });

  it('drops a pending click on cancel, repeatedly', () => {
    const { gate, calls, advance } = setup();
    gate.click();
    gate.cancel();
    gate.cancel();
    advance(1000);
    assert.deepEqual(calls, []);
  });
});
