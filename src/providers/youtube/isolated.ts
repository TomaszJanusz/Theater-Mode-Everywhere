import { YouTubeAdapter } from '../../media-features/youtube-adapter';
import { providerRuntime } from '../provider-api';

import { youtubeLauncherPlacement } from './launcher-placement';
import { findYouTubeQueueNavigation, readYouTubeControls, YOUTUBE_PLAYER_SELECTOR } from './navigation';
import { createYouTubeServiceActions } from './service-actions';
import { youtubeWatchPlayback } from './watch-playback';

const api = providerRuntime('isolated');
const services = api?.services;
if (services) api?.register({
  id: 'youtube', contractVersion: 1,
  watchPlayback: youtubeWatchPlayback,
  createAdapter: video => new YouTubeAdapter(video),
  launcherPlacement: youtubeLauncherPlacement,
  navigation: { playerSelector: YOUTUBE_PLAYER_SELECTOR, readControls: readYouTubeControls, queue: findYouTubeQueueNavigation },
  serviceActions: options => createYouTubeServiceActions({ ...options, elementToken: services.serviceElementToken })
});
