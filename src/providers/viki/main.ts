import { providerRuntime } from '../provider-api';

import { vikiWatchPlayback } from './watch-playback';

// Viki needs the native watch identity bridge, but no network harvesting or fetch wrapper.
providerRuntime('main')?.register({ id: 'viki', contractVersion: 1, watchPlayback: vikiWatchPlayback });
