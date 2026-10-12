import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { armPictureDismiss, clearPictureDismiss, consumePictureDismiss } from './picture-dismiss';

describe('picture dismiss latch', () => {
  it('lets one picture click dismiss chrome and the next toggle playback', () => {
    clearPictureDismiss();
    assert.equal(consumePictureDismiss(), false);
    armPictureDismiss();
    armPictureDismiss();
    assert.equal(consumePictureDismiss(), true);
    assert.equal(consumePictureDismiss(), false);
  });

  it('drops a pending dismiss when the pointer goes elsewhere or a key is pressed', () => {
    armPictureDismiss();
    clearPictureDismiss();
    assert.equal(consumePictureDismiss(), false);
  });
});
