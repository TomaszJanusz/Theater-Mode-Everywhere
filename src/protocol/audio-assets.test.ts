import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { ECHO_WASM_PATH, ECHO_WORKLET_PATH, offerAudioAssets, parseAudioAssets, receiveAudioAssets } from './audio-assets';

const ASSETS = {
  worklet: `chrome-extension://3f84f52a-0c1d-4e2b-9a7f-5d6e7f8a9b0c/${ECHO_WORKLET_PATH}`,
  wasm: `chrome-extension://3f84f52a-0c1d-4e2b-9a7f-5d6e7f8a9b0c/${ECHO_WASM_PATH}`
};

/** Both content scripts share the document; every dispatch is seen by every listener, page ones included. */
describe('audio asset handoff', () => {
  const original = (globalThis as { document?: unknown }).document;
  let seen: string[];
  beforeEach(() => {
    const doc = new EventTarget();
    seen = [];
    const dispatch = doc.dispatchEvent.bind(doc);
    doc.dispatchEvent = (event: Event) => { seen.push(event.type); return dispatch(event); };
    (globalThis as { document?: unknown }).document = doc;
  });
  afterEach(() => { (globalThis as { document?: unknown }).document = original; });

  it('reaches MAIN whichever content script starts first', () => {
    const mainFirst = receiveAudioAssets();
    offerAudioAssets(ASSETS);
    assert.deepEqual(mainFirst(), ASSETS);

    (globalThis as { document?: unknown }).document = new EventTarget();
    offerAudioAssets(ASSETS);
    const isolatedFirst = receiveAudioAssets();
    assert.deepEqual(isolatedFirst(), ASSETS);
  });

  it('answers one request only, so a later page request learns nothing', () => {
    offerAudioAssets(ASSETS);
    const main = receiveAudioAssets();
    assert.deepEqual(main(), ASSETS);
    let leaked: unknown = null;
    document.addEventListener('theater-everywhere-audio-assets', event => { leaked = (event as CustomEvent).detail; });
    document.dispatchEvent(new CustomEvent('theater-everywhere-audio-assets-request'));
    assert.equal(leaked, null);
  });

  it('keeps the first valid offer and ignores forged ones', () => {
    const main = receiveAudioAssets();
    const offer = (detail: unknown) => document.dispatchEvent(new CustomEvent('theater-everywhere-audio-assets', { detail }));
    offer(`https://evil.example/${ECHO_WORKLET_PATH} https://evil.example/${ECHO_WASM_PATH}`);
    assert.equal(main(), null);
    offerAudioAssets(ASSETS);
    offer(`moz-extension://other/${ECHO_WORKLET_PATH} moz-extension://other/${ECHO_WASM_PATH}`);
    assert.deepEqual(main(), ASSETS);
    assert.ok(seen.includes('theater-everywhere-audio-assets-accepted'));
  });

  it('accepts only this extension’s two files', () => {
    const firefox = `moz-extension://72044327-aaaa-bbbb-cccc-1234567890ab/`;
    assert.deepEqual(parseAudioAssets(`${firefox}${ECHO_WORKLET_PATH} ${firefox}${ECHO_WASM_PATH}`),
      { worklet: `${firefox}${ECHO_WORKLET_PATH}`, wasm: `${firefox}${ECHO_WASM_PATH}` });
    for (const detail of [
      null, 42, '', `${firefox}${ECHO_WORKLET_PATH}`,
      `${firefox}${ECHO_WASM_PATH} ${firefox}${ECHO_WORKLET_PATH}`,
      `${firefox}${ECHO_WORKLET_PATH} ${firefox}${ECHO_WASM_PATH} ${firefox}extra.js`,
      `${firefox}x/${ECHO_WORKLET_PATH} ${firefox}${ECHO_WASM_PATH}`
    ]) assert.equal(parseAudioAssets(detail), null, String(detail));
  });
});
