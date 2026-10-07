import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { nativePlaybackSurface } from './playback-surface';

describe('picture in picture', () => {
  it('clears a site opt-out before requesting the window', async () => {
    const calls: boolean[] = [];
    const video = {
      disablePictureInPicture: true,
      removeAttribute(name: string) {
        if (name === 'disablepictureinpicture') this.disablePictureInPicture = false;
      },
      requestPictureInPicture() {
        calls.push(this.disablePictureInPicture);
        return Promise.resolve();
      }
    };
    await nativePlaybackSurface(video as unknown as HTMLVideoElement).requestPictureInPicture();
    assert.deepEqual(calls, [false]);
  });
});
