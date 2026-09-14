import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PlayerUiStore } from './store';

describe('PlayerUiStore', () => {
  it('hydrates immutable state and notifies subscribers', () => {
    const store = new PlayerUiStore();
    const seen: boolean[] = [];
    const unsubscribe = store.subscribe((state) => seen.push(state.theaterActive));
    store.dispatch({ type: 'SET_THEATER_ACTIVE', value: true });
    store.dispatch({ type: 'SET_HELP_OPEN', value: true });
    unsubscribe();
    store.dispatch({ type: 'SET_THEATER_ACTIVE', value: false });
    assert.deepEqual(seen, [true, true]);
    assert.equal(store.getState().theaterActive, false);
    assert.equal(store.getState().helpOpen, false);
  });
});
