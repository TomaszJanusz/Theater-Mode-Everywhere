import { mediaProviderIntegrationEnabled } from '../../media-features/provider-flags';
import { providerRuntime } from '../provider-api';

import { BilibiliAdapter } from './adapter';
import { allowsBilibiliMediaFetch } from './fetch-policy';
import { BILIBILI_PLAYER_SELECTOR, readBilibiliControls } from './navigation';
import { createBilibiliServiceActions } from './service-actions';
import { bilibiliWatchPlayback } from './watch-playback';

const api = providerRuntime('isolated');
const services = api?.services;
if (services) api?.register({
  id: 'bilibili', contractVersion: 1, watchPlayback: bilibiliWatchPlayback,
  allowsMediaFetch: allowsBilibiliMediaFetch,
  createAdapter: () => new BilibiliAdapter(services),
  navigation: { playerSelector: BILIBILI_PLAYER_SELECTOR, readControls: readBilibiliControls, surfaces: '.bpx-player-ctrl-prev, .bpx-player-ctrl-next' },
  serviceActions(options) {
    const source = createBilibiliServiceActions({ ...options, elementToken: services.serviceElementToken });
    const doc = options.document ?? document;
    const root = options.element?.getRootNode();
    return { ...source, subscribe: changed => services.observeProviderDom({
      root: root instanceof ShadowRoot ? root : doc, selector: BILIBILI_PLAYER_SELECTOR, changed,
      enabled: () => mediaProviderIntegrationEnabled('bilibili'),
      relevant: record => {
        const element = record.target instanceof Element ? record.target : record.target.parentElement;
        return record.type === 'childList' || Boolean(element?.closest('button, a'));
      }
    }) };
  }
});
