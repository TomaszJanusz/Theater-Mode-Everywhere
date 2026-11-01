
import type { ServiceActionSource } from '../core/service-actions';
import { mediaProviderIntegrationEnabled, type MediaProviderId } from '../media-features/provider-flags';

import { createCrunchyrollServiceActions } from './crunchyroll/service-actions';
import { createDisneyServiceActions } from './disney/service-actions';
import { observeProviderDom } from './dom-watch';
import { isCrunchyrollHost, isDisneyHost } from './hosts';
import type { ServiceActionOptions } from './native-service-actions';
import { providerRegistry } from './runtime-registration';

/** Provider composition belongs here; the shared CTA only consumes actions. */
export function createServiceActions(options: ServiceActionOptions = {}): ServiceActionSource | null {
  if (isDisneyHost()) return createDisneyServiceActions();
  if (isCrunchyrollHost()) return observed(createCrunchyrollServiceActions(), 'crunchyroll', '#player-container');
  for (const hooks of providerRegistry.all()) {
    const source = hooks.serviceActions?.(options);
    if (source) return source;
  }
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
