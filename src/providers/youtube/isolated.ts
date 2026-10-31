import { YouTubeAdapter } from '../../media-features/youtube-adapter';
import { providerRuntime } from '../provider-api';

import { youtubeChat } from './chat';
import { youtubeChatTheme } from './chat-theme';
import { createYouTubeEndScreen } from './end-screen';
import { youtubeEvents } from './events';
import { youtubeLauncherPlacement } from './launcher-placement';
import { findYouTubeQueueNavigation, readYouTubeControls, YOUTUBE_PLAYER_SELECTOR } from './navigation';
import { createYouTubeServiceActions } from './service-actions';
import { youtubeSponsorBlockSource } from './sponsorblock';
import { youtubeTimeline } from './timeline';
import { youtubeWatchPlayback } from './watch-playback';

const api = providerRuntime('isolated');
const services = api?.services;
if (services) api?.register({
  id: 'youtube', contractVersion: 1,
  watchPlayback: youtubeWatchPlayback,
  endScreen: createYouTubeEndScreen,
  createAdapter: video => new YouTubeAdapter(video, services),
  launcherPlacement: youtubeLauncherPlacement,
  timeline: youtubeTimeline,
  timelineMarkers: youtubeSponsorBlockSource,
  events: youtubeEvents,
  chat: { ...youtubeChat, theme: youtubeChatTheme },
  navigation: {
    playerSelector: YOUTUBE_PLAYER_SELECTOR, readControls: readYouTubeControls, queue: findYouTubeQueueNavigation,
    surfaces: '.ytp-prev-button, .ytp-next-button, ytd-playlist-panel-renderer'
  },
  serviceActions: options => createYouTubeServiceActions({ ...options, elementToken: services.serviceElementToken, observe: services.observeProviderDom })
});
