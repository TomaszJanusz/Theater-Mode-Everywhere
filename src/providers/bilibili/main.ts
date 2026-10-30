import { providerRuntime } from '../provider-api';

import { allowsBilibiliMediaFetch } from './fetch-policy';
import { installBilibiliHistory } from './history';
import { readBilibiliSnapshot, trackBilibiliVisits } from './snapshot';
import { bilibiliWatchPlayback } from './watch-playback';

// Bilibili requests its own scoped metadata; it needs no harvesting or fetch wrapper.
providerRuntime('main')?.register({
  id: 'bilibili', contractVersion: 1, watchPlayback: bilibiliWatchPlayback,
  allowsMediaFetch: allowsBilibiliMediaFetch,
  // A superseded request stops waiting; the part's shared read stops when its visit ends.
  probeAsync: signal => readBilibiliSnapshot(signal),
  install() {
    installBilibiliHistory();
    trackBilibiliVisits();
  }
});
