import { providerRuntime } from '../provider-api';

import { installIqiyiNavigation, readIqiyiSnapshot } from './snapshot';
import { iqiyiWatchPlayback } from './watch-playback';

providerRuntime('main')?.register({
  id: 'iqiyi', contractVersion: 1, watchPlayback: iqiyiWatchPlayback,
  probe: readIqiyiSnapshot,
  install: installIqiyiNavigation
});
