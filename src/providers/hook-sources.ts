import { mediaProviderIntegrationEnabled } from '../media-features/provider-flags';

import type { ProviderHooks } from './provider-api';
import { providerRegistry } from './runtime-registration';

/** Isolated hooks that open a feature source for the theater's bound element. */
type ElementSources = {
  [K in 'endScreen' | 'playbackEnd' | 'playlistPanel']: NonNullable<ReturnType<NonNullable<ProviderHooks[K]>>>
};

/** The source the first integration-enabled provider opens for `element`; none leaves the feature out. */
export function enabledProviderSource<K extends keyof ElementSources>(hook: K, element: HTMLElement): ElementSources[K] | undefined {
  for (const hooks of providerRegistry.all()) {
    // Each hook in ElementSources takes the element and returns its own source (or none); TypeScript cannot
    // narrow `hooks[hook]` for a generic key.
    const open = hooks[hook] as ((element: HTMLElement) => ElementSources[K] | undefined) | undefined;
    const source = mediaProviderIntegrationEnabled(hooks.id) ? open?.(element) : undefined;
    if (source) return source;
  }
  return undefined;
}
