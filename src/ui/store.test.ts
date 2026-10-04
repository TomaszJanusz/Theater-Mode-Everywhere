import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PlayerUiStore } from './store';

describe('PlayerUiStore', () => {
  it('retains the pin preference across sessions and ignores duplicate storage notifications', () => {
    const store = new PlayerUiStore();
    let changes = 0;
    store.subscribe(() => changes++);
    assert.equal(store.getState().keepControlsVisible, false);
    store.dispatch({ type: 'SET_KEEP_CONTROLS_VISIBLE', value: true });
    const pinned = store.getState();
    store.dispatch({ type: 'SET_KEEP_CONTROLS_VISIBLE', value: true });
    assert.equal(store.getState(), pinned);
    assert.equal(changes, 1);
    store.dispatch({ type: 'SET_THEATER_ACTIVE', value: true });
    store.dispatch({ type: 'SET_THEATER_ACTIVE', value: false });
    assert.equal(store.getState().keepControlsVisible, true);
  });

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

  it('exposes hydrated values as the live UI state', () => {
    const store = new PlayerUiStore();
    store.dispatch({ type: 'HYDRATE', value: { theaterActive: true, videoFit: 'cover' } });
    assert.equal(store.getState().theaterActive, true);
    assert.equal(store.getState().videoFit, 'cover');
    store.dispatch({ type: 'SET_VIDEO_FIT', value: 'cover' });
    assert.equal(store.getState().videoFit, 'cover');
  });
});
