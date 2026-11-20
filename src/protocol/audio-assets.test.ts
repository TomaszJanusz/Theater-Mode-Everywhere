import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { ECHO_WASM_PATH, ECHO_WORKLET_PATH, echoWasmUrl, offerAudioAssets, parseWorkletUrl, receiveAudioAssets } from './audio-assets';

const EVENT = 'theater-everywhere-audio-assets';
const BASE = 'chrome-extension://3f84f52a-0c1d-4e2b-9a7f-5d6e7f8a9b0c/';
const getURL = (path: string) => BASE + path;
const ASSETS = getURL(ECHO_WORKLET_PATH);

/** Both content scripts share the document; every dispatch is seen by every listener, page ones included. */
describe('audio asset handoff', () => {
  const original = (globalThis as { document?: unknown }).document;
  beforeEach(() => { (globalThis as { document?: unknown }).document = new EventTarget(); });
  afterEach(() => { (globalThis as { document?: unknown }).document = original; });

  it('reaches MAIN whichever content script starts first', () => {
    const mainFirst = receiveAudioAssets();
    offerAudioAssets(getURL);
    assert.deepEqual(mainFirst(), ASSETS);

    (globalThis as { document?: unknown }).document = new EventTarget();
    offerAudioAssets(getURL);
    const isolatedFirst = receiveAudioAssets();
    assert.deepEqual(isolatedFirst(), ASSETS);
  });

  for (const order of ['MAIN first', 'isolated first'] as const) {
    it(`never answers a later page request (${order})`, () => {
      const main = order === 'MAIN first' ? receiveAudioAssets() : null;
      offerAudioAssets(getURL);
      const reader = main ?? receiveAudioAssets();
      assert.deepEqual(reader(), ASSETS);
      let leaked: unknown = null;
      document.addEventListener(EVENT, event => { leaked ??= (event as CustomEvent).detail; });
      document.dispatchEvent(new CustomEvent(EVENT));
      assert.equal(leaked, null);
    });
  }

  it('keeps the first valid offer and ignores forged ones', () => {
    const main = receiveAudioAssets();
    const offer = (detail: unknown) => document.dispatchEvent(new CustomEvent(EVENT, { detail, cancelable: true }));
    assert.equal(offer(`https://evil.example/${ECHO_WORKLET_PATH} https://evil.example/${ECHO_WASM_PATH}`), true, 'a forged offer is not taken');
    assert.equal(main(), null);
    offerAudioAssets(getURL);
    offer(`moz-extension://other/${ECHO_WORKLET_PATH}`);
    assert.deepEqual(main(), ASSETS);
  });

  it('accepts only this extension’s worklet URL, and finds the DSP beside it', () => {
    const firefox = 'moz-extension://72044327-aaaa-bbbb-cccc-1234567890ab/';
    assert.equal(parseWorkletUrl(firefox + ECHO_WORKLET_PATH), firefox + ECHO_WORKLET_PATH);
    assert.equal(echoWasmUrl(firefox + ECHO_WORKLET_PATH), firefox + ECHO_WASM_PATH);
    for (const detail of [
      null, 42, '', firefox + ECHO_WASM_PATH, `${firefox}x/${ECHO_WORKLET_PATH}`, `${firefox}${ECHO_WORKLET_PATH} ${firefox}extra.js`,
      `https://evil.example/${ECHO_WORKLET_PATH}`, `${firefox}${ECHO_WORKLET_PATH}?x`
    ]) assert.equal(parseWorkletUrl(detail), null, String(detail));
  });
});
