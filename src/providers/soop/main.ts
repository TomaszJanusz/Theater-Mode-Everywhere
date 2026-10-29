import { providerRuntime } from '../provider-api';

import { soopChat } from './chat';
import { allowsSoopMediaFetch } from './fetch-policy';
import { installSoopNavigation } from './history';
import { soopWatchPlayback } from './watch-playback';

// The chat hook is registered here too: the MAIN-world entry shortcut capture must leave keys typed in the chat alone.
providerRuntime('main')?.register({
  id: 'soop', contractVersion: 1, watchPlayback: soopWatchPlayback,
  allowsMediaFetch: allowsSoopMediaFetch, install: installSoopNavigation, chat: soopChat
});
