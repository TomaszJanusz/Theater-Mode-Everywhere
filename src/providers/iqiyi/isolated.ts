import { providerRuntime } from '../provider-api';

import { IqiyiAdapter } from './adapter';
import { readIqiyiCaptionLayout } from './captions';
import { IQIYI_PLAYER_SELECTOR } from './dom';
import { readIqiyiControls } from './navigation';
import { iqiyiWatchPlayback } from './watch-playback';

const api = providerRuntime('isolated');
const services = api?.services;
if (services) api?.register({
  id: 'iqiyi', contractVersion: 1,
  watchPlayback: iqiyiWatchPlayback,
  createAdapter: video => new IqiyiAdapter(video, services),
  hostCaptions: () => ({ read: () => readIqiyiCaptionLayout() }),
  navigation: { playerSelector: IQIYI_PLAYER_SELECTOR, readControls: readIqiyiControls }
});
