import { providerRuntime } from '../provider-api';

import { youtubeWatchPlayback } from './watch-playback';

providerRuntime('main')?.register({ id: 'youtube', contractVersion: 1, watchPlayback: youtubeWatchPlayback });
