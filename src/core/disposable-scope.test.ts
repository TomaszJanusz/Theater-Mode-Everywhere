import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DisposableScope } from './disposable-scope';

describe('F-07 DisposableScope', () => {
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

  it('clears pending timeouts', async () => {
    const scope = new DisposableScope();
    let fired = false;
    scope.timeout(() => { fired = true; }, 20);
    scope.dispose();
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(fired, false);
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
});
