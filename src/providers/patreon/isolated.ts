import { providerAuthorHosts } from '../author-byline';
import { mountAuthorByline } from '../author-byline-view';
import { providerRuntime } from '../provider-api';

import { PatreonAdapter } from './adapter';
import { PATREON_AVATAR_HOSTS } from './creator';
import descriptor from './provider.json';
import { createPatreonSettings } from './settings';
import { patreonWatchPlayback } from './watch-playback';

const AUTHOR_HOSTS = providerAuthorHosts(descriptor.hosts, PATREON_AVATAR_HOSTS);

const api = providerRuntime('isolated');
const services = api?.services;
if (services) api?.register({
  id: 'patreon', contractVersion: 1,
  watchPlayback: patreonWatchPlayback,
  createAdapter: () => new PatreonAdapter(services),
  authorByline: (_element, host) => mountAuthorByline(host, { provider: 'patreon', hosts: AUTHOR_HOSTS, settings: createPatreonSettings() })
});
