import { providerRuntime } from '../provider-api';

import { installNetflixAudio } from './audio-main';
import { handleNetflixMediaSeek, installNetflixMain, readNetflixSnapshot } from './main';
import { netflixWatchPlayback } from './watch-playback';

const api = providerRuntime('main');
const services = api?.services;
if (services) api?.register({
  id: 'netflix', contractVersion: 1, watchPlayback: netflixWatchPlayback,
  seek: handleNetflixMediaSeek,
  probe: readNetflixSnapshot,
  install() {
    installNetflixMain();
    installNetflixAudio(services.navigationObserver());
  }
});
