import { mediaProviderIntegrationEnabled } from '../../media-features/provider-flags';
import { providerAuthorHosts } from '../author-byline';
import { mountAuthorByline } from '../author-byline-view';
import { providerRuntime } from '../provider-api';

import { BilibiliAdapter } from './adapter';
import { BILIBILI_AVATAR_HOSTS } from './authors';
import { createBilibiliEndScreen } from './end-screen';
import { allowsBilibiliMediaFetch } from './fetch-policy';
import { BILIBILI_PLAYER_SELECTOR, readBilibiliControls } from './navigation';
import descriptor from './provider.json';
import { createBilibiliServiceActions } from './service-actions';
import { createBilibiliSettings } from './settings';
import { bilibiliWatchPlayback } from './watch-playback';

const AUTHOR_HOSTS = providerAuthorHosts(descriptor.hosts, BILIBILI_AVATAR_HOSTS);

const api = providerRuntime('isolated');
const services = api?.services;
if (services) api?.register({
  id: 'bilibili', contractVersion: 1, watchPlayback: bilibiliWatchPlayback,
  allowsMediaFetch: allowsBilibiliMediaFetch,
  endScreen: createBilibiliEndScreen,
  authorByline: (_element, host) => mountAuthorByline(host, { provider: 'bilibili', hosts: AUTHOR_HOSTS, settings: createBilibiliSettings() }),
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
