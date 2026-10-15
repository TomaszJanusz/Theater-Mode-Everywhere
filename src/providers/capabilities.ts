import { youtubeCapabilities } from './youtube/capabilities';
import { vimeoCapabilities } from './vimeo/capabilities';
import { patreonCapabilities } from './patreon/capabilities';
import { twitchCapabilities } from './twitch/capabilities';
import { disneyCapabilities } from './disney/capabilities';
import { netflixCapabilities } from './netflix/capabilities';
import { bilibiliCapabilities } from './bilibili/capabilities';
import { bilibiliIntlCapabilities } from './bilibili-intl/capabilities';
import { tencentCapabilities } from './tencent/capabilities';
import { crunchyrollCapabilities } from './crunchyroll/capabilities';
import type { ProviderCapabilities } from './capability-types';

export { MEDIA_CAPABILITIES, type MediaCapability, type ProviderCapabilities } from './capability-types';

export const PROVIDER_CAPABILITIES: readonly ProviderCapabilities[] = [
  youtubeCapabilities,
  vimeoCapabilities,
  patreonCapabilities,
  twitchCapabilities,
  disneyCapabilities,
  netflixCapabilities,
  bilibiliCapabilities,
  bilibiliIntlCapabilities,
  tencentCapabilities,
  crunchyrollCapabilities,
];
