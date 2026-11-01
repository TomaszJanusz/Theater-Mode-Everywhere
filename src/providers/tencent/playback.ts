import type { ProviderPlayback } from '../provider-api';

import { isTencentHost } from './hosts';
import { openTencentPlaybackSession } from './playback-session';
import {
  isTencentWasmFrameDocument, isTencentWasmPlayerElement, isUsableTencentWasmPlayer,
  readTencentWasmHostToggle, selectTencentTheaterTarget, tencentWasmContentWindows
} from './wasm-player';

export const tencentPlayback: ProviderPlayback = {
  frameDocument: isTencentWasmFrameDocument(),
  theaterTarget({ best, switchable: pool }) {
    if (!isTencentHost()) return undefined;
    const preferred = best && pool.includes(best) ? best : pool[0];
    const switchable = pool.length > 0 ? preferred : null;
    const wasm = Array.from(document.querySelectorAll('fake-iframe-video')).find(element => isUsableTencentWasmPlayer(element)) || null;
    return selectTencentTheaterTarget({ switchable, wasm, fallback: best, wasmFrameDocument: false });
  },
  fullscreenFollowsTarget: isTencentHost(),
  openSession: (element, options) => isTencentWasmPlayerElement(element) ? openTencentPlaybackSession(element, options) : null,
  hostToggle: readTencentWasmHostToggle,
  playerFrameWindows: tencentWasmContentWindows
};
