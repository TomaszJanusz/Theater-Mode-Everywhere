import { providerRuntime } from '../provider-api';

import { allowsIntlMediaFetch } from './fetch-policy';
import { installIntlNavigation } from './history';
import { readBilibiliIntlSnapshot, trackIntlVisits } from './snapshot';
import { bilibiliIntlWatchPlayback } from './watch-playback';

// Bilibili.tv requests its own scoped metadata; it needs no harvesting or fetch wrapper.
providerRuntime('main')?.register({
  id: 'bilibiliIntl', contractVersion: 1, watchPlayback: bilibiliIntlWatchPlayback,
  allowsMediaFetch: allowsIntlMediaFetch,
  // A superseded request stops waiting; the route's shared read stops when its visit ends.
  probeAsync: signal => readBilibiliIntlSnapshot(signal),
  install() {
    installIntlNavigation();
    trackIntlVisits();
  }
});
