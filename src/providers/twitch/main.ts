import { providerRuntime } from '../provider-api';

import { twitchChat } from './chat';
import { installTwitchMain, probeTwitch, twitchNetworkHarvest } from './harvest';
import { installTwitchNavigation } from './navigation';
import { twitchWatchPlayback } from './watch-playback';

// The chat hook is registered here too: MAIN's entry shortcut capture must leave chat keys alone, and chat-only
// popouts must stay chat documents. The palette stays in the isolated world.
providerRuntime('main')?.register({
  id: 'twitch', contractVersion: 1, watchPlayback: twitchWatchPlayback,
  chat: twitchChat,
  harvest: twitchNetworkHarvest,
  probe: probeTwitch,
  install() {
    installTwitchMain();
    installTwitchNavigation();
  }
});
