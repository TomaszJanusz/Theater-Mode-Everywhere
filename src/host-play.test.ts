import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isHostPlayControlLabel, mainWorldOwnsWasmPlayPause, mediaHasSource, toggleDirectPlayback } from './host-play';

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

  it('pauses an already playing element that has no HTML source', () => {
    let plays = 0;
    let pauses = 0;
    toggleDirectPlayback({
      paused: false,
      play: () => { plays += 1; },
      pause: () => { pauses += 1; }
    });
    assert.equal(plays, 0);
    assert.equal(pauses, 1);
    toggleDirectPlayback({
      paused: true,
      play: () => { plays += 1; },
      pause: () => { pauses += 1; }
    });
    assert.equal(plays, 1);
    assert.equal(pauses, 1);
  });
});

function key(overrides: Partial<KeyboardEvent> & Pick<KeyboardEvent, 'key' | 'code'>): KeyboardEvent {
  return {
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...overrides
  } as KeyboardEvent;
}

describe('wasm play/pause ownership', () => {
  it('owns literal Space when that shortcut is Space or unpublished', () => {
    const space = key({ key: ' ', code: 'Space' });
    assert.equal(mainWorldOwnsWasmPlayPause(space, 'Space'), true);
    assert.equal(mainWorldOwnsWasmPlayPause(space, null), true);
    assert.equal(mainWorldOwnsWasmPlayPause(space, ''), false);
    assert.equal(mainWorldOwnsWasmPlayPause(space, 'K'), false);
  });

  it('leaves a remapped play/pause key to the content script', () => {
    assert.equal(mainWorldOwnsWasmPlayPause(key({ key: 'k', code: 'KeyK' }), 'K'), false);
    assert.equal(mainWorldOwnsWasmPlayPause(key({ key: 'k', code: 'KeyK' }), null), false);
    assert.equal(mainWorldOwnsWasmPlayPause(key({ key: ' ', code: 'Space', shiftKey: true }), 'Shift+Space'), true);
  });
});
