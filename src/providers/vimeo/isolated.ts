import { providerRuntime } from '../provider-api';

import { VimeoAdapter } from './adapter';
import { readVimeoShowcaseControls } from './navigation';
import { vimeoWatchPlayback } from './watch-playback';

const api = providerRuntime('isolated');
const services = api?.services;
if (services) api?.register({
  id: 'vimeo', contractVersion: 1,
  watchPlayback: vimeoWatchPlayback,
  createAdapter: () => new VimeoAdapter(services),
  navigation: { readControls: readVimeoShowcaseControls }
});
