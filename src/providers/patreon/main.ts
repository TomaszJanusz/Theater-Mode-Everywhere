import { mediaProviderIntegrationEnabled } from '../../media-features/provider-flags';
import { providerRuntime } from '../provider-api';

import { installPatreonNavigation } from './navigation';
import { readPatreonSnapshot } from './snapshot';
import { patreonWatchPlayback } from './watch-playback';

providerRuntime('main')?.register({
  id: 'patreon', contractVersion: 1, watchPlayback: patreonWatchPlayback,
  probe: () => mediaProviderIntegrationEnabled('patreon') ? readPatreonSnapshot() : null,
  install: installPatreonNavigation
});
