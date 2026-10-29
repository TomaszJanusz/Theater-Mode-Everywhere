import type { ProviderHarvest } from '../provider-api';

import { youtubeHarvestTarget } from './harvest-target';
import {
  cacheTimedtextBody, captureTimedtextResponse, harvestTimedtextJson, harvestYoutubeHeatmapJson,
  harvestYoutubeHeatmapText, youtubeIntegrationEnabled
} from './player-main';

export const youtubeHarvest: ProviderHarvest = {
  qualify: (url, pageUrl) => youtubeIntegrationEnabled() ? youtubeHarvestTarget(url, pageUrl) : null,
  json(target, url, data) {
    if (target === 'timedtext') harvestTimedtextJson(url, data);
    else harvestYoutubeHeatmapJson(url, data);
  },
  text(target, url, text) {
    if (target === 'timedtext') cacheTimedtextBody(url, text);
    else harvestYoutubeHeatmapText(url, text);
  },
  // The page's own caption fetch: the cache reads the one owned clone, bounded by the core.
  cloneTargets: ['timedtext'],
  response(_target, url, clone) { captureTimedtextResponse(url, clone); }
};
