import assert from 'node:assert/strict';
import { it } from 'node:test';

import { measureNextFrame } from './frame-batch';

/** A window whose frames and root resize observations the test delivers by hand. */
class TestView {
  serial = 0;
  frames = new Map<number, FrameRequestCallback>();
  observers = new Set<{ callback: () => void; observed: boolean }>();
  document = { documentElement: {} };
  requestAnimationFrame = (callback: FrameRequestCallback) => { this.frames.set(++this.serial, callback); return this.serial; };
  cancelAnimationFrame = (id: number) => { this.frames.delete(id); };
  ResizeObserver: unknown;
  constructor(resizeObserver = true) {
    const observers = this.observers;
    this.ResizeObserver = resizeObserver ? class {
      entry: { callback: () => void; observed: boolean };
      constructor(callback: () => void) { this.entry = { callback, observed: false }; observers.add(this.entry); }
      observe() { this.entry.observed = true; }
      disconnect() { this.entry.observed = false; }
    } : undefined;
  }
  window() { return this as unknown as Window; }
  animationFrames() {
    const pending = [...this.frames.values()];
    this.frames.clear();
    pending.forEach(callback => callback(0));
  }
  /** Animation frame callbacks, then the resize observations of that frame's layout. */
  frame() {
    this.animationFrames();
    for (const observer of [...this.observers].filter(entry => entry.observed)) observer.callback();
  }
}

it('runs every queued measurement before any of their writes, after the frame lays out', () => {
  const view = new TestView();
  const log: string[] = [];
  measureNextFrame(view.window(), () => { log.push('read a'); return () => log.push('write a'); });
  measureNextFrame(view.window(), () => { log.push('read b'); });
  measureNextFrame(view.window(), () => { log.push('read c'); return () => log.push('write c'); });
  assert.equal(view.frames.size, 1, 'one frame for the whole batch');
  // The animation frame only arms the observer; layout of that frame delivers it.
  view.animationFrames();
  assert.deepEqual(log, []);
  for (const observer of view.observers) observer.callback();
  assert.deepEqual(log, ['read a', 'read b', 'read c', 'write a', 'write c']);
  assert.equal(view.frames.size, 0, 'the fallback frame is cancelled');
  assert.ok([...view.observers].every(entry => !entry.observed), 'the root is observed only while armed');
});

it('queues requests made during a phase for the next frame, and skips cancelled entries', () => {
  const view = new TestView();
  const log: string[] = [];
  let cancelLate: () => void = () => {};
  measureNextFrame(view.window(), () => {
    log.push('read 1');
    return () => { log.push('write 1'); cancelLate(); measureNextFrame(view.window(), () => { log.push('read next'); }); };
  });
  cancelLate = measureNextFrame(view.window(), () => { log.push('read 2'); return () => log.push('write 2'); });
  const cancelled = measureNextFrame(view.window(), () => { log.push('never'); });
  cancelled();
  view.frame();
  assert.deepEqual(log, ['read 1', 'read 2', 'write 1']);
  view.frame();
  assert.deepEqual(log, ['read 1', 'read 2', 'write 1', 'read next']);
});

it('requests no frame once every entry is cancelled, and falls back to the next frame without a layout', () => {
  const view = new TestView();
  const cancel = measureNextFrame(view.window(), () => { throw new Error('cancelled entry measured'); });
  cancel();
  assert.equal(view.frames.size, 0);

  const log: string[] = [];
  measureNextFrame(view.window(), () => { log.push('read'); });
  view.animationFrames();
  // No resize observation arrives, e.g. the document has no box; the following frame runs the phase.
  view.animationFrames();
  assert.deepEqual(log, ['read']);
  assert.ok([...view.observers].every(entry => !entry.observed));

  const plain = new TestView(false);
  measureNextFrame(plain.window(), () => { log.push('plain'); });
  plain.frame();
  assert.deepEqual(log, ['read', 'plain']);
});

it('reports a failing reader without dropping the others', () => {
  const view = new TestView();
  const reported: unknown[] = [];
  const original = globalThis.reportError;
  globalThis.reportError = (error: unknown) => { reported.push(error); };
  try {
    const log: string[] = [];
    measureNextFrame(view.window(), () => { throw new Error('read failed'); });
    measureNextFrame(view.window(), () => () => { throw new Error('write failed'); });
    measureNextFrame(view.window(), () => () => { log.push('write'); });
    view.frame();
    assert.deepEqual(log, ['write']);
    assert.deepEqual(reported.map(error => (error as Error).message), ['read failed', 'write failed']);
  } finally {
    globalThis.reportError = original;
  }
});
