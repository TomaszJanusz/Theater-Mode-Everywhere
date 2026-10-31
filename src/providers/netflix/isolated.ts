import { providerRuntime } from '../provider-api';

import { NetflixAudioAdapter } from './audio-adapter';
import { netflixWatchPlayback } from './watch-playback';

providerRuntime('isolated')?.register({
  id: 'netflix', contractVersion: 1,
  watchPlayback: netflixWatchPlayback,
  createAdapter: video => new NetflixAudioAdapter(video)
});
