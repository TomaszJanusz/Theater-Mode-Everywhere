import assert from 'node:assert/strict';
import { describe, it, type TestContext } from 'node:test';
import { DisposableScope } from './disposable-scope';

function fakeClock(t: TestContext) {
  let nextId = 1;
  const timers = new Map<number, () => void>();
  const frames = new Map<number, FrameRequestCallback>();
  const clearedTimers: number[] = [];
  const cancelledFrames: number[] = [];
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const replace = (key: string, value: unknown) => {
    if (!originals.has(key)) {
      const original = Object.getOwnPropertyDescriptor(globalThis, key);
      originals.set(key, original);
      t.after(() => {
        if (original) Object.defineProperty(globalThis, key, original);
        else Reflect.deleteProperty(globalThis, key);
      });
    }
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };
  replace('setTimeout', (handler: () => void) => {
    const id = nextId++;
    timers.set(id, handler);
    return id;
  });
  replace('clearTimeout', (id: number) => {
    clearedTimers.push(id);
    timers.delete(id);
  });
  replace('requestAnimationFrame', (handler: FrameRequestCallback) => {
    const id = nextId++;
    frames.set(id, handler);
    return id;
  });
  replace('cancelAnimationFrame', (id: number) => {
    cancelledFrames.push(id);
    frames.delete(id);
  });
  const flushTimers = () => {
    for (const [id, handler] of Array.from(timers)) {
      timers.delete(id);
      handler();
    }
  };
  const flushFrames = () => {
    for (const [id, handler] of Array.from(frames)) {
      frames.delete(id);
      handler(123);
    }
  };
  return { timers, frames, clearedTimers, cancelledFrames, flushTimers, flushFrames, replace };
}

function retainedEntries(scope: DisposableScope): number {
  const entries: unknown = Reflect.get(scope, 'disposers');
  assert.ok(entries instanceof Set);
  return entries.size;
}

describe('DisposableScope resource lifecycle', () => {
  it('removes event listeners on dispose', () => {
    const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
    const stub: EventTarget = {
      addEventListener(type, listener) {
        if (!listener) return;
        const set = listeners.get(type) || new Set();
        set.add(listener);
        listeners.set(type, set);
      },
      removeEventListener(type, listener) {
        if (!listener) return;
        listeners.get(type)?.delete(listener);
      },
      dispatchEvent(event) {
        for (const listener of listeners.get(event.type) || []) {
          if (typeof listener === 'function') listener(event);
        }
        return true;
      }
    };

    const scope = new DisposableScope();
    let count = 0;
    const handler = () => { count += 1; };
    scope.listen(stub, 'theater-everywhere-playback-intent', handler);
    stub.dispatchEvent(new Event('theater-everywhere-playback-intent'));
    assert.equal(count, 1);
    scope.dispose();
    stub.dispatchEvent(new Event('theater-everywhere-playback-intent'));
    assert.equal(count, 1);
  });

  it('is idempotent and aborts child scopes', () => {
    const parent = new DisposableScope();
    const child = parent.child();
    let childDisposed = 0;
    child.add(() => { childDisposed += 1; });
    parent.dispose();
    parent.dispose();
    assert.equal(childDisposed, 1);
    assert.equal(parent.isDisposed, true);
    assert.equal(child.isDisposed, true);
    assert.equal(parent.signal.aborted, true);
  });

  it('clears pending timeouts', t => {
    const clock = fakeClock(t);
    const scope = new DisposableScope();
    let fired = false;
    const id = scope.timeout(() => { fired = true; }, 20);
    const queued = Array.from(clock.timers.values())[0];
    scope.dispose();
    clock.flushTimers();
    queued();
    assert.equal(fired, false);
    assert.deepEqual(clock.clearedTimers, [id]);
    assert.equal(clock.timers.size, 0);
  });

  it('drops document capture listeners used for drag when disposed mid-gesture', () => {
    const listeners = new Map<string, number>();
    const stub: EventTarget = {
      addEventListener(type) {
        listeners.set(type, (listeners.get(type) || 0) + 1);
      },
      removeEventListener(type) {
        listeners.set(type, (listeners.get(type) || 1) - 1);
      },
      dispatchEvent() {
        return true;
      }
    };
    const controlsScope = new DisposableScope();
    const gestureScope = controlsScope.child();
    gestureScope.listen(stub, 'mousemove', () => {}, true);
    gestureScope.listen(stub, 'mouseup', () => {}, true);
    controlsScope.dispose();
    assert.equal(listeners.get('mousemove'), 0);
    assert.equal(listeners.get('mouseup'), 0);
  });

  it('forgets 1000 completed timeouts and frames instead of retaining closures until teardown', t => {
    const clock = fakeClock(t);
    const scope = new DisposableScope();
    let fired = 0;
    for (let index = 0; index < 1000; index += 1) {
      scope.timeout(() => { fired += 1; }, 1);
      scope.raf(() => { fired += 1; });
    }
    assert.equal(retainedEntries(scope), 2000);
    clock.flushTimers();
    clock.flushFrames();
    assert.equal(fired, 2000);
    assert.equal(retainedEntries(scope), 0);
    scope.dispose();
    assert.deepEqual(clock.clearedTimers, []);
    assert.deepEqual(clock.cancelledFrames, []);
  });

  it('unregisters a completed task before invoking a callback that throws', t => {
    const clock = fakeClock(t);
    const scope = new DisposableScope();
    scope.timeout(() => { throw new Error('timeout failure'); }, 1);
    assert.throws(clock.flushTimers, /timeout failure/);
    assert.equal(retainedEntries(scope), 0);
    scope.raf(() => { throw new Error('frame failure'); });
    assert.throws(clock.flushFrames, /frame failure/);
    assert.equal(retainedEntries(scope), 0);
    scope.dispose();
    assert.deepEqual(clock.clearedTimers, []);
    assert.deepEqual(clock.cancelledFrames, []);
  });

  it('cancels pending RAF and ignores a stale callback delivered after disposal', t => {
    const clock = fakeClock(t);
    const scope = new DisposableScope();
    let fired = 0;
    const id = scope.raf(() => { fired += 1; });
    const queued = clock.frames.get(id);
    assert.ok(queued);
    scope.dispose();
    clock.flushFrames();
    queued(123);
    assert.equal(fired, 0);
    assert.deepEqual(clock.cancelledFrames, [id]);
    assert.equal(retainedEntries(scope), 0);
  });

  it('does not schedule timeouts or frames after disposal', t => {
    const clock = fakeClock(t);
    const scope = new DisposableScope();
    scope.dispose();
    let fired = false;
    scope.timeout(() => { fired = true; }, 0);
    scope.raf(() => { fired = true; });
    clock.flushTimers();
    clock.flushFrames();
    assert.equal(fired, false);
    assert.equal(clock.timers.size, 0);
    assert.equal(clock.frames.size, 0);
    assert.deepEqual(clock.clearedTimers, []);
    assert.deepEqual(clock.cancelledFrames, []);
  });

  it('uses the same completion and cancellation lifecycle for the RAF timeout fallback', t => {
    const clock = fakeClock(t);
    clock.replace('requestAnimationFrame', undefined);
    const scope = new DisposableScope();
    let timestamp = -1;
    scope.raf(time => { timestamp = time; });
    clock.flushTimers();
    assert.equal(timestamp, 0);
    assert.equal(retainedEntries(scope), 0);
    const pending = scope.raf(() => { throw new Error('cancelled fallback'); });
    scope.dispose();
    clock.flushTimers();
    assert.deepEqual(clock.clearedTimers, [pending]);
  });

  it('preserves reverse disposal and duplicate registrations while isolating cleanup failures', () => {
    const scope = new DisposableScope();
    const calls: string[] = [];
    const shared = () => { calls.push('shared'); };
    scope.add(shared);
    const unregister = scope.add(() => { calls.push('forgotten'); });
    scope.add(() => { calls.push('throws'); throw new Error('cleanup failure'); });
    scope.add(shared);
    unregister();
    unregister();
    scope.dispose();
    scope.dispose();
    assert.deepEqual(calls, ['shared', 'throws', 'shared']);
    assert.equal(scope.signal.aborted, true);
    assert.equal(retainedEntries(scope), 0);
  });

  it('does not retain manually disposed children in a long-lived parent', () => {
    const parent = new DisposableScope();
    for (let index = 0; index < 1000; index += 1) parent.child().dispose();
    assert.equal(retainedEntries(parent), 0);
    const activeChild = parent.child();
    parent.dispose();
    assert.equal(activeChild.isDisposed, true);
    assert.equal(retainedEntries(parent), 0);
  });

});
