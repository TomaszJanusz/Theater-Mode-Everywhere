import { parseCaptionPayload } from '../media-features/parsers/captions';
import { requestMediaProbe, requestPageFetch, requestProviderProbe } from '../media-features/probe';
import { fetchPageMedia } from '../platform/page-fetch';
import { observeProviderDom } from '../providers/dom-watch';
import { serviceElementToken } from '../providers/native-service-actions';
import { exposeProviderRuntime, type ProviderHooks, type ProviderWorld } from '../providers/provider-api';
import { providerRegistry } from '../providers/runtime-registration';

const firstHooks = new Map<string, ProviderHooks>();

/**
 * A fixture bundle can hold both worlds, which then share one registry: a provider's second world adds only
 * the hooks its first registration lacks (MAIN's harvest and install join the isolated adapter and theme).
 */
function register(hooks: ProviderHooks): boolean {
  const first = firstHooks.get(hooks.id);
  if (!first) {
    firstHooks.set(hooks.id, hooks);
    return providerRegistry.register(hooks);
  }
  for (const [key, value] of Object.entries(hooks)) if (!(key in first)) Object.assign(first, { [key]: value });
  return providerRegistry.state(hooks.id) === 'ready';
}

/** Fixture wiring only: provider implementation is a separate script, just as in the manifest. */
export function exposeFixtureRuntime(world: ProviderWorld): void {
  if (world === 'main') exposeProviderRuntime('main', { contractVersion: 1, register, start() {}, services: { fetchPageMedia } });
  else exposeProviderRuntime('isolated', { contractVersion: 1, register, start() {}, services: {
    requestPageFetch, requestMediaProbe: (timeoutMs?: number) => requestMediaProbe(timeoutMs),
    requestProviderProbe: (provider, timeoutMs) => requestProviderProbe(provider, timeoutMs), serviceElementToken, observeProviderDom, parseCaptionPayload
  } });
}
