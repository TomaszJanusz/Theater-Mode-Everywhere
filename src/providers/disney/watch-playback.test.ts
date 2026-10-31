import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { disneyVideoRole, isUsableDisneyMediaVideo } from './watch-playback';

/** A `<video>` as the checks read it: classes, inline style, size and source. */
function video(className: string, overrides: Record<string, unknown> = {}): HTMLVideoElement {
  return {
    className, style: { display: 'block' }, videoWidth: 1280, clientWidth: 1334, clientHeight: 862,
    src: 'blob:https://www.disneyplus.com/abc', currentSrc: 'blob:https://www.disneyplus.com/abc',
    getBoundingClientRect: () => ({ width: 1334, height: 862 }),
    ...overrides
  } as unknown as HTMLVideoElement;
}

/** The hidden btm media client video, as recorded when the dummy filter was added. */
const dummy = () => video('btm-media-client-element', {
  style: { display: 'none' }, videoWidth: 0, clientWidth: 0, clientHeight: 0, src: '', currentSrc: '',
  getBoundingClientRect: () => ({ width: 0, height: 0 })
});

describe('Disney+ content video identity', () => {
  it('names the content video by mediaElement, whatever classes Disney gave it', () => {
    // Disney's UI rewrite, read on the real host: hive-video replaced by the btm and styler classes.
    const content = video('btm-media-client-element fontDefault windowOpacity0');
    assert.equal(disneyVideoRole(content, content), 'content');
    assert.equal(isUsableDisneyMediaVideo(content, 'content'), true);
    const loading = video('btm-media-client-element', { videoWidth: 0, src: '', currentSrc: '' });
    assert.equal(isUsableDisneyMediaVideo(loading, disneyVideoRole(loading, loading)), true, 'the content video needs no source while it reloads');
  });

  it('still rejects the dummy, and any other btm video, beside a named content video', () => {
    const content = video('hive-video');
    assert.equal(disneyVideoRole(dummy(), content), 'dummy');
    assert.equal(isUsableDisneyMediaVideo(dummy(), disneyVideoRole(dummy(), content)), false);
    const visibleBtm = video('btm-media-client-element');
    assert.equal(disneyVideoRole(visibleBtm, content), 'dummy', 'only mediaElement may carry the btm class');
    const otherHive = video('hive-video');
    assert.equal(disneyVideoRole(otherHive, content), 'candidate', 'with a named content video, hive-video names nothing');
  });

  it('falls back to the classes when the player names no mediaElement', () => {
    assert.equal(disneyVideoRole(video('hive-video'), null), 'content');
    assert.equal(disneyVideoRole(dummy(), null), 'dummy');
    assert.equal(disneyVideoRole(video(''), null), 'candidate');
    assert.equal(isUsableDisneyMediaVideo(dummy(), 'dummy'), false);
  });

  it('rejects a hidden content video and a candidate without a box', () => {
    const hidden = video('hive-video', { style: { display: 'none' } });
    assert.equal(isUsableDisneyMediaVideo(hidden, 'content'), false);
    const boxless = video('', { clientWidth: 0, clientHeight: 0, getBoundingClientRect: () => ({ width: 0, height: 0 }) });
    assert.equal(isUsableDisneyMediaVideo(boxless, 'candidate'), false);
    assert.equal(isUsableDisneyMediaVideo(null), false);
  });
});
