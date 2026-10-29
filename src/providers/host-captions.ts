import type { HostCaptionLayoutSource } from '../media-features/types';

import { readCrunchyrollHostCaptionLayout } from './crunchyroll/host-surface';
import { readDisneyHostCaptionLayout } from './disney/host-captions';
import { isCrunchyrollHost, isDisneyHost, isIqiyiHost, isNetflixHost, isVikiHost } from './hosts';
import { readIqiyiCaptionLayout } from './iqiyi/captions';
import { createNetflixHostCaptions } from './netflix/host-captions';
import { providerRegistry } from './runtime-registration';
import { readVikiCaptionLayout } from './viki/host-captions';

/** Native caption presentation remains usable with media integrations disabled. */
export function createHostCaptionLayoutSource(): HostCaptionLayoutSource | null {
  if (isNetflixHost()) return createNetflixHostCaptions();
  if (isCrunchyrollHost()) return { read: readCrunchyrollHostCaptionLayout };
  if (isDisneyHost()) return { read: readDisneyHostCaptionLayout };
  if (isIqiyiHost()) return { read: () => readIqiyiCaptionLayout() };
  if (isVikiHost()) return { read: readVikiCaptionLayout };
  for (const hooks of providerRegistry.all()) {
    if (hooks.hostCaptions) return hooks.hostCaptions();
  }
  return null;
}
