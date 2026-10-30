import { providerRuntime } from '../provider-api';

import { TwitchAdapter } from './adapter';
import { twitchChat } from './chat';
import { twitchChatTheme } from './chat-theme';
import { twitchVideoAbandoned } from './discovery';
import { TWITCH_HARVEST_EVENT } from './snapshot';
import { twitchTheaterStage } from './stage';
import { twitchWatchPlayback } from './watch-playback';

const api = providerRuntime('isolated');
const services = api?.services;
if (services) api?.register({
  id: 'twitch', contractVersion: 1, watchPlayback: twitchWatchPlayback,
  events: { media: [TWITCH_HARVEST_EVENT] },
  createAdapter: () => new TwitchAdapter(services),
  stage: twitchTheaterStage,
  discovery: { abandonedVideo: twitchVideoAbandoned },
  chat: { ...twitchChat, theme: twitchChatTheme }
});
