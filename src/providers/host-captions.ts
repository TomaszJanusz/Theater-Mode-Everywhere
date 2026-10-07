import type { HostCaptionLayoutSource } from '../media-features/types';
import { isCrunchyrollHost, isNetflixHost } from './hosts';
import { createNetflixHostCaptions } from './netflix/host-captions';
import { readCrunchyrollHostCaptionLayout } from './crunchyroll/host-surface';

/** Native caption presentation remains usable with media integrations disabled. */
export function createHostCaptionLayoutSource(): HostCaptionLayoutSource | null {
  if (isNetflixHost()) return createNetflixHostCaptions();
  if (isCrunchyrollHost()) return { read: readCrunchyrollHostCaptionLayout };
  return null;
}
