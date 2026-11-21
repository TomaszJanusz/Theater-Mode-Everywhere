import { providerAuthorHosts } from '../author-byline';
import { mountAuthorByline } from '../author-byline-view';
import { providerRuntime } from '../provider-api';

import { VimeoAdapter } from './adapter';
import { readVimeoShowcaseControls } from './navigation';
import { VIMEO_AVATAR_HOSTS } from './owner';
import descriptor from './provider.json';
import { createVimeoSettings } from './settings';
import { vimeoWatchPlayback } from './watch-playback';

const AUTHOR_HOSTS = providerAuthorHosts(descriptor.hosts, VIMEO_AVATAR_HOSTS);

const api = providerRuntime('isolated');
const services = api?.services;
if (services) api?.register({
  id: 'vimeo', contractVersion: 1,
  watchPlayback: vimeoWatchPlayback,
  createAdapter: () => new VimeoAdapter(services),
  navigation: { readControls: readVimeoShowcaseControls },
  authorByline: (_element, host) => mountAuthorByline(host, { provider: 'vimeo', hosts: AUTHOR_HOSTS, settings: createVimeoSettings() })
});
