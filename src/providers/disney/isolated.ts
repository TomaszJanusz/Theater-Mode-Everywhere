import { providerRuntime } from '../provider-api';

import { DisneyAudioAdapter } from './audio-adapter';
import { disneyWatchPlayback } from './watch-playback';

// Audio is the first Disney+ feature loaded per host; the rest stays legacy until TME-203.
providerRuntime('isolated')?.register({
  id: 'disney', contractVersion: 1,
  watchPlayback: disneyWatchPlayback,
  createAdapter: video => new DisneyAudioAdapter(video)
});
