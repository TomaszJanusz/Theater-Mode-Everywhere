import { providerRuntime } from '../provider-api';

import { PatreonAdapter } from './adapter';
import { patreonWatchPlayback } from './watch-playback';

const api = providerRuntime('isolated');
const services = api?.services;
if (services) api?.register({
  id: 'patreon', contractVersion: 1,
  watchPlayback: patreonWatchPlayback,
  createAdapter: () => new PatreonAdapter(services)
});
