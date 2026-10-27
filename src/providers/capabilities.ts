import { bilibiliCapabilities } from './bilibili/capabilities';
import { bilibiliIntlCapabilities } from './bilibili-intl/capabilities';
import type { ProviderCapabilities } from './capability-types';
import { crunchyrollCapabilities } from './crunchyroll/capabilities';
import { disneyCapabilities } from './disney/capabilities';
import { iqiyiCapabilities } from './iqiyi/capabilities';
import { netflixCapabilities } from './netflix/capabilities';
import { patreonCapabilities } from './patreon/capabilities';
import { tencentCapabilities } from './tencent/capabilities';
import { twitchCapabilities } from './twitch/capabilities';
import { vimeoCapabilities } from './vimeo/capabilities';
import { youtubeCapabilities } from './youtube/capabilities';

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
  iqiyiCapabilities,
];
