import { providerRuntime } from '../provider-api';

import { readVimeoSnapshot, vimeoIntegrationEnabled } from './snapshot';
import { vimeoWatchPlayback } from './watch-playback';

providerRuntime('main')?.register({
  id: 'vimeo', contractVersion: 1, watchPlayback: vimeoWatchPlayback,
  probe: () => vimeoIntegrationEnabled() ? readVimeoSnapshot() : null
});
