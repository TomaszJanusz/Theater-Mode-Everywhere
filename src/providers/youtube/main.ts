import { providerRuntime } from '../provider-api';

import { youtubeChat } from './chat';
import { youtubeEvents } from './events';
import { youtubeWatchPlayback } from './watch-playback';

providerRuntime('main')?.register({ id: 'youtube', contractVersion: 1, watchPlayback: youtubeWatchPlayback, events: youtubeEvents,
  // MAIN's entry shortcut capture must recognize keys typed in the chat; the palette stays isolated.
  chat: youtubeChat });
