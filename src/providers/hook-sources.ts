import { mediaProviderIntegrationEnabled } from '../media-features/provider-flags';

import type { ProviderHooks } from './provider-api';
import { providerRegistry } from './runtime-registration';

/** Isolated hooks that open a feature source for the theater's bound element. */
type SourceHook = 'authorByline' | 'endScreen' | 'playbackEnd' | 'playlistPanel' | 'videoQuality';
type Open<K extends SourceHook> = NonNullable<ProviderHooks[K]>;

/** The source the first integration-enabled provider opens for the bound element; none leaves the feature out. */
export function enabledProviderSource<K extends SourceHook>(hook: K, ...args: Parameters<Open<K>>): NonNullable<ReturnType<Open<K>>> | undefined {
  for (const hooks of providerRegistry.all()) {
    // Each of these hooks takes the element (and its own options) and returns its source or none; TypeScript cannot
    // narrow `hooks[hook]` for a generic key.
    const open = hooks[hook] as ((...given: Parameters<Open<K>>) => ReturnType<Open<K>>) | undefined;
    const source = mediaProviderIntegrationEnabled(hooks.id) ? open?.(...args) : undefined;
    if (source) return source as NonNullable<ReturnType<Open<K>>>;
  }
  return undefined;
}
