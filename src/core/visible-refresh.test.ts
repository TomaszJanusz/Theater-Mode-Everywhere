import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createVisibleRefresh } from './visible-refresh';

class Clock extends EventTarget {
  now = 0;
  serial = 0;
  frames = new Map<number, FrameRequestCallback>();
  timers = new Map<number, { due: number; callback: () => void }>();
  requestAnimationFrame = (callback: FrameRequestCallback) => { this.frames.set(++this.serial, callback); return this.serial; };
  cancelAnimationFrame = (id: number) => { this.frames.delete(id); };
  setTimeout = (callback: () => void, delay: number) => {
    this.timers.set(++this.serial, { due: this.now + delay, callback }); return this.serial;
  };
  clearTimeout = (id: number) => { this.timers.delete(id); };
  frame() { const pending = [...this.frames.values()]; this.frames.clear(); pending.forEach(callback => callback(this.now)); }
  advance(ms: number) {
    const end = this.now + ms;
    while (true) {
      const next = [...this.timers].sort((a, b) => a[1].due - b[1].due)[0];
      if (!next || next[1].due > end) break;
      this.now = next[1].due; this.timers.delete(next[0]); next[1].callback();
    }
    this.now = end;
  }
}
class TestDocument extends EventTarget {
  hidden = false;
  defaultView = new Clock();
  document() { return this as unknown as Document; }
  visibility(hidden: boolean) { this.hidden = hidden; this.dispatchEvent(new Event('visibilitychange')); }
}

it('coalesces events, bounds fallback to 1 Hz and cancels all scheduled work while hidden or disposed', () => {
  const doc = new TestDocument(), clock = doc.defaultView;
  let reads = 0;
  const refresh = createVisibleRefresh(doc.document(), () => { reads++; }, { pollMs: 10, events: ['mediachange'] });
  refresh.refresh(); assert.equal(reads, 1);
  for (let i = 0; i < 100; i++) clock.dispatchEvent(new Event('mediachange'));
  assert.equal(clock.frames.size, 1); clock.frame(); assert.equal(reads, 2);
  clock.advance(999); assert.equal(reads, 2);
  clock.advance(1); assert.equal(reads, 3);
  doc.visibility(true); clock.advance(10000); refresh.request();
  assert.equal(reads, 3); assert.equal(clock.timers.size, 0); assert.equal(clock.frames.size, 0);
  doc.visibility(false); assert.equal(reads, 4);
  refresh.request(); const late = [...clock.frames.values()][0];
  refresh.dispose(); refresh.dispose(); late(0); clock.advance(10000);
  clock.dispatchEvent(new Event('mediachange')); doc.visibility(false);
  assert.equal(reads, 4); assert.equal(clock.timers.size, 0); assert.equal(clock.frames.size, 0);
});

it('can dispose during a read without creating a new timer, and disables fallback without disabling events', () => {
  const doc = new TestDocument(), clock = doc.defaultView;
  let active = true, reads = 0;
  const refresh = createVisibleRefresh(doc.document(), () => {
    reads++; if (reads === 3) refresh.dispose();
  }, { active: () => active });
  refresh.refresh(); active = false; refresh.request(); clock.frame();
  assert.equal(reads, 2); assert.equal(clock.timers.size, 0);
  active = true; refresh.refresh();
  assert.equal(reads, 3); assert.equal(clock.timers.size, 0);
});
