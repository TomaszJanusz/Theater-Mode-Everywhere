import { providerRuntime } from '../provider-api';

import { installNetflixAudio } from './audio-main';
import { netflixWatchPlayback } from './watch-playback';

const api = providerRuntime('main');
const services = api?.services;
if (services) api?.register({
  id: 'netflix', contractVersion: 1, watchPlayback: netflixWatchPlayback,
  install: () => installNetflixAudio(services.navigationObserver())
});
