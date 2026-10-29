import { providerRuntime } from '../provider-api';

import { allowsSoopMediaFetch } from './fetch-policy';
import { installSoopNavigation } from './history';
import { soopWatchPlayback } from './watch-playback';

providerRuntime('main')?.register({
  id: 'soop', contractVersion: 1, watchPlayback: soopWatchPlayback,
  allowsMediaFetch: allowsSoopMediaFetch, install: installSoopNavigation
});
