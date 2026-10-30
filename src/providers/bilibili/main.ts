import { providerRuntime } from '../provider-api';

import { allowsBilibiliMediaFetch } from './fetch-policy';
import { installBilibiliHistory } from './history';
import { readBilibiliSnapshot } from './snapshot';
import { bilibiliWatchPlayback } from './watch-playback';

// Bilibili requests its own scoped metadata; it needs no harvesting or fetch wrapper.
providerRuntime('main')?.register({
  id: 'bilibili', contractVersion: 1, watchPlayback: bilibiliWatchPlayback,
  allowsMediaFetch: allowsBilibiliMediaFetch,
  // The snapshot cache is shared by requests for the same part, so a superseded read is not aborted.
  probeAsync: () => readBilibiliSnapshot(),
  install: installBilibiliHistory
});
