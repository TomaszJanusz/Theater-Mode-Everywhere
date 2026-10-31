import type { EndScreenSource, PlaybackEndSource } from '../core/end-screen';
import { mediaProviderIntegrationEnabled } from '../media-features/provider-flags';

import { providerRegistry } from './runtime-registration';

export function createEndScreen(element: HTMLElement): EndScreenSource | undefined {
  for (const hooks of providerRegistry.all()) {
    if (mediaProviderIntegrationEnabled(hooks.id) && hooks.endScreen) return hooks.endScreen(element);
  }
  return undefined;
}

export function createPlaybackEnd(element: HTMLElement): PlaybackEndSource | undefined {
  for (const hooks of providerRegistry.all()) {
    if (mediaProviderIntegrationEnabled(hooks.id) && hooks.playbackEnd) return hooks.playbackEnd(element);
  }
  return undefined;
}
