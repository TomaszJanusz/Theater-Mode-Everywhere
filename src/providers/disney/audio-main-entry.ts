import { providerRuntime } from '../provider-api';

import { installDisneyAudio } from './audio-main';
import { disneyWatchPlayback } from './watch-playback';

providerRuntime('main')?.register({
  id: 'disney', contractVersion: 1, watchPlayback: disneyWatchPlayback,
  install: installDisneyAudio
});
