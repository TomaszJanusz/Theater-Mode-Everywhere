import { providerRuntime } from '../provider-api';

import { TencentAdapter } from './adapter';
import { isTencentHost } from './hosts';
import { readTencentControls, TENCENT_NAV_SURFACES, TENCENT_PLAYER_SELECTOR } from './navigation';
import { tencentPlayback } from './playback';
import { injectTencentWasmFrameStyles, tencentTheaterStage, tencentVideosShareContainer } from './stage';
import { isTencentWasmFrameDocument } from './wasm-player';

const api = providerRuntime('isolated');
const services = api?.services;
// The player frame has no metadata or host controls. Other CDN documents stay generic.
if (services && (isTencentHost() || isTencentWasmFrameDocument())) api?.register({
  id: 'tencent', contractVersion: 1,
  playback: tencentPlayback,
  ...(isTencentHost() ? {
    createAdapter: () => new TencentAdapter(services),
    stage: tencentTheaterStage,
    discovery: { prepareShadowRoot: injectTencentWasmFrameStyles, sharesPlaybackHost: tencentVideosShareContainer, standbySelector: '.txp_videos_container' },
    navigation: { playerSelector: TENCENT_PLAYER_SELECTOR, readControls: readTencentControls, surfaces: TENCENT_NAV_SURFACES }
  } : {})
});
