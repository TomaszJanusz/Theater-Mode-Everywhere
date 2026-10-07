import { createBilibiliServiceActions } from './bilibili/service-actions';
import { createBilibiliIntlServiceActions, type BilibiliIntlServiceActionHooks } from './bilibili-intl/service-actions';
import { createCrunchyrollServiceActions } from './crunchyroll/service-actions';
import { createDisneyServiceActions } from './disney/service-actions';
import { createNetflixServiceActions } from './netflix/service-actions';
import { createYouTubeServiceActions } from './youtube/service-actions';
import { isBilibiliHost, isBilibiliIntlHost, isCrunchyrollHost, isDisneyHost, isNetflixHost, isYouTubeHost } from './hosts';
import type { ServiceActionSource } from '../core/service-actions';

/** Provider composition belongs here; the shared CTA only consumes actions. */
export function createServiceActions(options: BilibiliIntlServiceActionHooks = {}): ServiceActionSource | null {
  if (isNetflixHost()) return createNetflixServiceActions();
  if (isYouTubeHost()) return createYouTubeServiceActions(options);
  if (isBilibiliHost()) return createBilibiliServiceActions(options);
  if (isBilibiliIntlHost()) return createBilibiliIntlServiceActions(options);
  if (isDisneyHost()) return createDisneyServiceActions();
  if (isCrunchyrollHost()) return createCrunchyrollServiceActions();
  return null;
}
