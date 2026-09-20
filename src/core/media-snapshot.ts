import type { CaptionTrack, Chapter, MediaCapabilities } from '../media-features/types';
import type { ProviderError } from './errors';

export type MediaSnapshot = {
  capabilities: MediaCapabilities;
  tracks: CaptionTrack[];
  chapters: Chapter[];
  errors: ProviderError[];
};

export function emptyMediaSnapshot(): MediaSnapshot {
  return {
    capabilities: { captions: false, chapters: false, previews: false },
    tracks: [],
    chapters: [],
    errors: []
  };
}
