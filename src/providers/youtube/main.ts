import { providerRuntime } from '../provider-api';

import { youtubeEvents } from './events';
import { youtubeWatchPlayback } from './watch-playback';

providerRuntime('main')?.register({ id: 'youtube', contractVersion: 1, watchPlayback: youtubeWatchPlayback, events: youtubeEvents });
