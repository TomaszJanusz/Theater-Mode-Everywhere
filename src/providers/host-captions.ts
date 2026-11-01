import type { HostCaptionLayoutSource } from '../media-features/types';

import { readCrunchyrollHostCaptionLayout } from './crunchyroll/host-surface';
import { isCrunchyrollHost } from './hosts';
import { providerRegistry } from './runtime-registration';

/** Native caption presentation remains usable with media integrations disabled. */
export function createHostCaptionLayoutSource(): HostCaptionLayoutSource | null {
  if (isCrunchyrollHost()) return { read: readCrunchyrollHostCaptionLayout };
  for (const hooks of providerRegistry.all()) {
    if (hooks.hostCaptions) return hooks.hostCaptions();
  }
  return null;
}
