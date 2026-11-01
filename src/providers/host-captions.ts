import type { HostCaptionLayoutSource } from '../media-features/types';

import { readCrunchyrollHostCaptionLayout } from './crunchyroll/host-surface';
import { readDisneyHostCaptionLayout } from './disney/host-captions';
import { isCrunchyrollHost, isDisneyHost } from './hosts';
import { providerRegistry } from './runtime-registration';

/** Native caption presentation remains usable with media integrations disabled. */
export function createHostCaptionLayoutSource(): HostCaptionLayoutSource | null {
  if (isCrunchyrollHost()) return { read: readCrunchyrollHostCaptionLayout };
  if (isDisneyHost()) return { read: readDisneyHostCaptionLayout };
  for (const hooks of providerRegistry.all()) {
    if (hooks.hostCaptions) return hooks.hostCaptions();
  }
  return null;
}
