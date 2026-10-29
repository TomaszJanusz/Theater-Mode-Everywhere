
import type { ServiceActionSource } from '../core/service-actions';
import { mediaProviderIntegrationEnabled, type MediaProviderId } from '../media-features/provider-flags';

import { createBilibiliServiceActions } from './bilibili/service-actions';
import { createBilibiliIntlServiceActions, type BilibiliIntlServiceActionHooks } from './bilibili-intl/service-actions';
import { createCrunchyrollServiceActions } from './crunchyroll/service-actions';
import { createDisneyServiceActions } from './disney/service-actions';
import { observeProviderDom } from './dom-watch';
import { isBilibiliHost, isBilibiliIntlHost, isCrunchyrollHost, isDisneyHost, isNetflixHost, isVikiHost } from './hosts';
import { createNetflixServiceActions } from './netflix/service-actions';
import { providerRegistry } from './runtime-registration';
import { createVikiServiceActions } from './viki/service-actions';

/** Provider composition belongs here; the shared CTA only consumes actions. */
export function createServiceActions(options: BilibiliIntlServiceActionHooks = {}): ServiceActionSource | null {
  if (isNetflixHost()) return createNetflixServiceActions();
  if (isBilibiliHost()) return observed(createBilibiliServiceActions(options), 'bilibili', '.bpx-player-container, .bilibili-player, #bilibiliPlayer');
  if (isBilibiliIntlHost()) return observed(createBilibiliIntlServiceActions(options), 'bilibiliIntl', '.bstar-player');
  if (isDisneyHost()) return createDisneyServiceActions();
  if (isCrunchyrollHost()) return observed(createCrunchyrollServiceActions(), 'crunchyroll', '#player-container');
  for (const hooks of providerRegistry.all()) {
    const source = hooks.serviceActions?.(options);
    if (source) return source;
  }
  if (isVikiHost()) return observed(createVikiServiceActions(), 'viki', '#vmplayer_id');
  return null;

  function observed(source: ServiceActionSource, provider: MediaProviderId, selector: string): ServiceActionSource {
    const doc = options.document ?? document;
    const root = options.element?.getRootNode();
    return { ...source, subscribe: changed => observeProviderDom({ root: root instanceof ShadowRoot ? root : doc,
      selector, changed, enabled: () => mediaProviderIntegrationEnabled(provider),
      relevant: record => {
        const element = record.target instanceof Element ? record.target : record.target.parentElement;
        return record.type === 'childList' || Boolean(element?.closest('button, a'));
      }
    }) };
  }
}
