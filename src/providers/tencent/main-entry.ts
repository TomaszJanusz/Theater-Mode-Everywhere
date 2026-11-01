import { providerRuntime } from '../provider-api';

import { tencentNetworkHarvest } from './harvest';
import { isTencentHost } from './hosts';
import { captureTencentNetworkResponse, harvestTencentBody, harvestTencentData, installTencentMain, readTencentSnapshot } from './main';
import { tencentEnabled } from './page';
import { isTencentWasmPlayerElement } from './wasm-player';

if (isTencentHost()) providerRuntime('main')?.register({
  id: 'tencent', contractVersion: 1,
  harvest: tencentNetworkHarvest({ json: harvestTencentData, text: harvestTencentBody, response: captureTencentNetworkResponse, enabled: tencentEnabled }),
  probe: readTencentSnapshot,
  install: installTencentMain,
  playbackElement: isTencentWasmPlayerElement
});
