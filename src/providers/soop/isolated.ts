import { mediaProviderIntegrationEnabled } from '../../media-features/provider-flags';
import { providerAuthorHosts } from '../author-byline';
import { mountAuthorByline } from '../author-byline-view';
import { observeProviderDom } from '../dom-watch';
import { providerRuntime } from '../provider-api';

import { SoopAdapter } from './adapter';
import { soopChat } from './chat';
import { soopChatTheme } from './chat-theme';
import { SOOP_PLAYER_SELECTOR } from './dom';
import { allowsSoopMediaFetch } from './fetch-policy';
import { readSoopControls } from './navigation';
import { SOOP_AVATAR_HOSTS } from './page';
import descriptor from './provider.json';
import { createSoopServiceActions } from './service-actions';
import { createSoopSettings } from './settings';
import { soopWatchPlayback } from './watch-playback';

const AUTHOR_HOSTS = providerAuthorHosts(descriptor.hosts, SOOP_AVATAR_HOSTS);

const api = providerRuntime('isolated');
const services = api?.services;
if (services) api?.register({
  id: 'soop', contractVersion: 1,
  watchPlayback: soopWatchPlayback,
  allowsMediaFetch: allowsSoopMediaFetch,
  createAdapter: video => new SoopAdapter(video, services.requestPageFetch),
  navigation: { playerSelector: SOOP_PLAYER_SELECTOR, readControls: readSoopControls },
  chat: { ...soopChat, theme: soopChatTheme },
  authorByline: (_element, host) => mountAuthorByline(host, { provider: 'soop', hosts: AUTHOR_HOSTS, settings: createSoopSettings() }),
  serviceActions() {
    // The registry hook gets no document/element options; SOOP's player lives in the light DOM of the page document.
    const source = createSoopServiceActions({ elementToken: services.serviceElementToken });
    return { ...source, subscribe: changed => observeProviderDom({ root: document, selector: SOOP_PLAYER_SELECTOR,
      changed, enabled: () => mediaProviderIntegrationEnabled('soop'), relevant: record => {
        const element = record.target instanceof Element ? record.target : record.target.parentElement;
        return record.type === 'childList' || Boolean(element?.closest('button, a'));
      }
    }) };
  }
});
