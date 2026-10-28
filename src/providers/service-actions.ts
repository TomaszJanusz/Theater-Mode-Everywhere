import type { ServiceActionSource } from '../core/service-actions';
import { mediaProviderIntegrationEnabled, type MediaProviderId } from '../media-features/provider-flags';

import { createBilibiliServiceActions } from './bilibili/service-actions';
import { createBilibiliIntlServiceActions, type BilibiliIntlServiceActionHooks } from './bilibili-intl/service-actions';
import { createCrunchyrollServiceActions } from './crunchyroll/service-actions';
import { createDisneyServiceActions } from './disney/service-actions';
import { observeProviderDom } from './dom-watch';
import { isBilibiliHost, isBilibiliIntlHost, isCrunchyrollHost, isDisneyHost, isNetflixHost, isSoopHost, isYouTubeHost } from './hosts';
import { createNetflixServiceActions } from './netflix/service-actions';
import { createSoopServiceActions } from './soop/service-actions';
import { createYouTubeServiceActions } from './youtube/service-actions';

/** Provider composition belongs here; the shared CTA only consumes actions. */
export function createServiceActions(options: BilibiliIntlServiceActionHooks = {}): ServiceActionSource | null {
  if (isNetflixHost()) return createNetflixServiceActions();
  if (isYouTubeHost()) return observed(createYouTubeServiceActions(options), 'youtube', '#movie_player, .html5-video-player');
  if (isBilibiliHost()) return observed(createBilibiliServiceActions(options), 'bilibili', '.bpx-player-container, .bilibili-player, #bilibiliPlayer');
  if (isBilibiliIntlHost()) return observed(createBilibiliIntlServiceActions(options), 'bilibiliIntl', '.bstar-player');
  if (isDisneyHost()) return createDisneyServiceActions();
  if (isCrunchyrollHost()) return observed(createCrunchyrollServiceActions(), 'crunchyroll', '#player-container');
  if (isSoopHost()) return observed(createSoopServiceActions(), 'soop', '#webplayer #player');
  return null;

  function observed(source: ServiceActionSource, provider: MediaProviderId, selector: string): ServiceActionSource {
    const doc = options.document ?? document;
    const root = options.element?.getRootNode();
    return { ...source, subscribe: changed => observeProviderDom({ root: root instanceof ShadowRoot ? root : doc,
      selector, changed, enabled: () => mediaProviderIntegrationEnabled(provider),
      relevant: record => {
        const element = record.target instanceof Element ? record.target : record.target.parentElement;
        if (provider === 'youtube') {
          const skip = '.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern';
          return Boolean(element?.closest(skip) || (record.type === 'attributes' && element?.matches(selector))
            || (record.type === 'childList' && [...record.addedNodes, ...record.removedNodes].some(node =>
              node instanceof Element && (node.matches(skip) || node.querySelector(skip)))));
        }
        return record.type === 'childList' || Boolean(element?.closest('button, a'));
      }
    }) };
  }
}
