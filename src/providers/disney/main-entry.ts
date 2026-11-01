import { providerRuntime } from '../provider-api';

import { installDisneyAudio } from './audio-main';
import { qualifyDisneyHarvest } from './harvest';
import {
  captureDisneyNetworkResponse,
  disneyIntegrationEnabled,
  fetchDisneyBifPage,
  handleDisneyMediaSeek,
  harvestDisneyBody,
  harvestDisneyData,
  installDisneyMain,
  readDisneySnapshot,
  rememberDisneyBif
} from './main';
import { disneyWatchPlayback } from './watch-playback';

const api = providerRuntime('main');
const services = api?.services;
if (services) api?.register({
  id: 'disney', contractVersion: 1, watchPlayback: disneyWatchPlayback,
  harvest: {
    qualify: url => qualifyDisneyHarvest(url, disneyIntegrationEnabled()),
    json: (_target, url, data) => harvestDisneyData(url, data),
    text: (_target, url, text) => harvestDisneyBody(url, text),
    cloneTargets: ['disney'],
    response: (_target, url, clone) => captureDisneyNetworkResponse(url, clone),
    binaryTargets: ['disney-bif'],
    binary: (_target, url, bytes) => rememberDisneyBif(bytes, url)
  },
  pageFetch: url => fetchDisneyBifPage(url, services.fetchPageMedia),
  seek: handleDisneyMediaSeek,
  probe: () => disneyIntegrationEnabled() ? readDisneySnapshot() : null,
  install() {
    installDisneyAudio();
    installDisneyMain();
  }
});
