import { providerRuntime } from '../provider-api';

import { NetflixAdapter } from './adapter';
import { createNetflixHostCaptions } from './host-captions';
import { findNetflixPlaylistActions, NETFLIX_WATCH_PLAYER } from './navigation';
import { NETFLIX_HARVEST_EVENT } from './page';
import { rankNetflixTheaterVideos } from './playback';
import { createNetflixServiceActions } from './service-actions';
import { netflixTheaterStage } from './stage';
import { netflixTimeline } from './timeline';
import { netflixWatchPlayback } from './watch-playback';

const api = providerRuntime('isolated');
const services = api?.services;
if (services) api?.register({
  id: 'netflix', contractVersion: 1, watchPlayback: netflixWatchPlayback,
  events: { media: [NETFLIX_HARVEST_EVENT] },
  createAdapter: video => new NetflixAdapter(video),
  stage: netflixTheaterStage,
  discovery: { rankBest: rankNetflixTheaterVideos },
  hostCaptions: () => createNetflixHostCaptions(),
  timeline: netflixTimeline,
  serviceActions: () => createNetflixServiceActions({ observe: services.observeProviderDom }),
  // The countdown fill (`.inner`) repaints every frame and never changes the step.
  navigation: { players: NETFLIX_WATCH_PLAYER, paints: '.inner', fallback: findNetflixPlaylistActions }
});
