import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isHostPlayControlLabel, mediaHasSource } from './host-play';

describe('host play controls', () => {
  it('recognizes unlabeled Vimeo Play buttons and YouTube overlay classes', () => {
    assert.equal(isHostPlayControlLabel('', 'Play'), true);
    assert.equal(isHostPlayControlLabel('Play', ''), true);
    assert.equal(isHostPlayControlLabel('Play (k)', ''), true);
    assert.equal(isHostPlayControlLabel('Odtwórz', ''), true);
    assert.equal(isHostPlayControlLabel('', '', 'ytp-large-play-button ytp-button'), true);
    assert.equal(isHostPlayControlLabel('', '', 'vjs-big-play-button'), true);
  });

  it('ignores pause and unrelated play-adjacent labels', () => {
    assert.equal(isHostPlayControlLabel('Pause', ''), false);
    assert.equal(isHostPlayControlLabel('Playlist', ''), false);
    assert.equal(isHostPlayControlLabel('Play on TV', ''), false);
    assert.equal(isHostPlayControlLabel('', 'Playing in picture-in-picture'), false);
    assert.equal(isHostPlayControlLabel('', 'Replay'), false);
  });

  it('treats empty video src as having no media source', () => {
    const video = {
      currentSrc: '',
      src: '',
      srcObject: null,
      querySelector: () => null
    } as unknown as HTMLVideoElement;
    assert.equal(mediaHasSource(video), false);
  });

  it('treats currentSrc, src, srcObject, or source[src] as a real media source', () => {
    assert.equal(mediaHasSource({
      currentSrc: 'https://example.com/a.mp4',
      src: '',
      srcObject: null,
      querySelector: () => null
    } as unknown as HTMLVideoElement), true);
    assert.equal(mediaHasSource({
      currentSrc: '',
      src: 'blob:https://example.com/1',
      srcObject: null,
      querySelector: () => null
    } as unknown as HTMLVideoElement), true);
    assert.equal(mediaHasSource({
      currentSrc: '',
      src: '',
      srcObject: {},
      querySelector: () => null
    } as unknown as HTMLVideoElement), true);
    assert.equal(mediaHasSource({
      currentSrc: '',
      src: '',
      srcObject: null,
      querySelector: () => ({})
    } as unknown as HTMLVideoElement), true);
  });
});
