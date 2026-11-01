import { providerRuntime } from '../provider-api';

import { DisneyAdapter } from './adapter';
import { readDisneyHostCaptionLayout } from './host-captions';
import { findDisneyPlaylistActions } from './navigation';
import { DISNEY_HARVEST_EVENT } from './page';
import { PLAY_NEXT_CHANGED_EVENT, retainDisneyNavCache } from './play-next';
import { createDisneyServiceActions } from './service-actions';
import { disneyTheaterStage, prepareDisneyShadowRoot } from './stage';
import { disneyTimeline } from './timeline';
import { disneyWatchPlayback } from './watch-playback';

const api = providerRuntime('isolated');
const services = api?.services;
if (services) api?.register({
  id: 'disney', contractVersion: 1, watchPlayback: disneyWatchPlayback,
  events: { media: [DISNEY_HARVEST_EVENT], domChange: [PLAY_NEXT_CHANGED_EVENT] },
  createAdapter: video => new DisneyAdapter(services, video),
  stage: disneyTheaterStage,
  // Disney+ mounts a display:none standby first when the next episode replaces the player, then adds the real video.
  discovery: { prepareShadowRoot: prepareDisneyShadowRoot, standbySelector: 'disney-web-player' },
  hostCaptions: () => ({ read: readDisneyHostCaptionLayout }),
  timeline: disneyTimeline,
  serviceActions: () => createDisneyServiceActions({ observe: services.observeProviderDom }),
  navigation: {
    players: 'disney-web-player, controls-overlay, main-app-controls-overlay',
    // The up-next countdown ring repaints without changing the step.
    paints: '.progress-ring__circle',
    controls: 'play-next',
    retainCache: retainDisneyNavCache,
    fallback: (root, _video, href) => findDisneyPlaylistActions(root, href)
  }
});
