import { providerRuntime } from '../provider-api';

import { allowsIntlMediaFetch } from './fetch-policy';
import { installIntlNavigation } from './history';
import { readBilibiliIntlSnapshot } from './snapshot';
import { bilibiliIntlWatchPlayback } from './watch-playback';

// Bilibili.tv requests its own scoped metadata; it needs no harvesting or fetch wrapper.
providerRuntime('main')?.register({
  id: 'bilibiliIntl', contractVersion: 1, watchPlayback: bilibiliIntlWatchPlayback,
  allowsMediaFetch: allowsIntlMediaFetch,
  // The snapshot cache is shared by requests for the same episode, so a superseded read is not aborted.
  probeAsync: () => readBilibiliIntlSnapshot(),
  install: installIntlNavigation
});
