import { providerRuntime } from '../provider-api';

import { youtubeChat } from './chat';
import { youtubeEvents } from './events';
import { youtubeHarvest } from './harvest';
import { fetchTimedtextWithPot, handleYoutubeMediaSeek, installYoutubeMain, isAllowedTimedtextUrl } from './player-main';
import { youtubeWatchPlayback } from './watch-playback';

const api = providerRuntime('main');
const services = api?.services;
if (services) api?.register({
  id: 'youtube', contractVersion: 1, watchPlayback: youtubeWatchPlayback, events: youtubeEvents,
  // MAIN's entry shortcut capture must recognize keys typed in the chat; the palette stays isolated.
  chat: youtubeChat,
  harvest: youtubeHarvest,
  // Timedtext needs the page's proof-of-origin token, which only YouTube's own player can mint.
  pageFetch: url => isAllowedTimedtextUrl(url) ? fetchTimedtextWithPot(url) : null,
  seek: handleYoutubeMediaSeek,
  install: () => installYoutubeMain(services.fetchPageMedia)
});
