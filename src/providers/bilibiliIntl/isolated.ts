import { mediaProviderIntegrationEnabled } from '../../media-features/provider-flags';
import { providerRuntime } from '../provider-api';

import { BilibiliIntlAdapter } from './adapter';
import { allowsIntlMediaFetch } from './fetch-policy';
import { BILIBILI_INTL_PLAYER_SELECTOR, readBilibiliIntlControls } from './navigation';
import { createBilibiliIntlServiceActions } from './service-actions';
import { bilibiliIntlWatchPlayback } from './watch-playback';

const api = providerRuntime('isolated');
const services = api?.services;
if (services) api?.register({
  id: 'bilibiliIntl', contractVersion: 1, watchPlayback: bilibiliIntlWatchPlayback,
  allowsMediaFetch: allowsIntlMediaFetch,
  createAdapter: () => new BilibiliIntlAdapter(services),
  // Bilibili.tv detaches the playing element before `emptied`; reload metadata from the current route.
  refreshOnElementReset: true,
  navigation: { playerSelector: BILIBILI_INTL_PLAYER_SELECTOR, readControls: readBilibiliIntlControls, surfaces: '.player-mobile-control-btn-next-episode' },
  serviceActions(options) {
    const source = createBilibiliIntlServiceActions({ ...options, elementToken: services.serviceElementToken });
    const doc = options.document ?? document;
    const root = options.element?.getRootNode();
    return { ...source, subscribe: changed => services.observeProviderDom({
      root: root instanceof ShadowRoot ? root : doc, selector: BILIBILI_INTL_PLAYER_SELECTOR, changed,
      enabled: () => mediaProviderIntegrationEnabled('bilibiliIntl'),
      relevant: record => {
        const element = record.target instanceof Element ? record.target : record.target.parentElement;
        return record.type === 'childList' || Boolean(element?.closest('button, a'));
      }
    }) };
  }
});
