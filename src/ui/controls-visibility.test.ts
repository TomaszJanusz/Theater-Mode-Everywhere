import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveChromeVisibility, resolveKeepControlsVisible, type ChromeActivity } from './controls-visibility';

const idle: ChromeActivity = {
  active: false, pinned: false, controlsHovered: false, scrubberDragging: false,
  keyboardFocused: false, headerActive: false, helpOpen: false
};

describe('player chrome visibility', () => {
  it('keeps auto-hide as the default, accepting only a boolean preference', () => {
    for (const value of [undefined, null, false, 1, 'true', {}, []]) {
      assert.equal(resolveKeepControlsVisible(value), false);
    }
    assert.equal(resolveKeepControlsVisible(true), true);
    assert.deepEqual(resolveChromeVisibility(idle), {
      controlsVisible: false, headerVisible: false, cursorVisible: false
    });
  });

  it('holds only the playback bar after activity expires while pinned', () => {
    assert.deepEqual(resolveChromeVisibility({ ...idle, pinned: true }), {
      controlsVisible: true, headerVisible: false, cursorVisible: false
    });
    assert.deepEqual(resolveChromeVisibility({ ...idle, pinned: true, active: true }), {
      controlsVisible: true, headerVisible: true, cursorVisible: true
    });
  });

  it('keeps the cursor usable during hover and dragging without holding the pinned header', () => {
    for (const interaction of ['controlsHovered', 'scrubberDragging'] as const) {
      assert.deepEqual(resolveChromeVisibility({ ...idle, pinned: true, [interaction]: true }), {
        controlsVisible: true, headerVisible: false, cursorVisible: true
      });
      assert.deepEqual(resolveChromeVisibility({ ...idle, [interaction]: true }), {
        controlsVisible: true, headerVisible: true, cursorVisible: true
      });
    }
  });

  it('preserves keyboard access to the header and holds chrome while help is open', () => {
    for (const interaction of ['keyboardFocused', 'headerActive', 'helpOpen'] as const) {
      for (const pinned of [false, true]) {
        assert.deepEqual(resolveChromeVisibility({ ...idle, pinned, [interaction]: true }), {
          controlsVisible: true, headerVisible: true, cursorVisible: true
        });
      }
    }
  });
});
