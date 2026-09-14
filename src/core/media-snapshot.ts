import type { CaptionTrack, Chapter, MediaCapabilities } from '../media-features/types';

export type MediaSnapshot = {
  capabilities: MediaCapabilities;
  tracks: CaptionTrack[];
  chapters: Chapter[];
  errors: unknown[];
};

export function emptyMediaSnapshot(): MediaSnapshot {
  return {
    capabilities: { captions: false, chapters: false, previews: false },
    tracks: [],
    chapters: [],
    errors: []
  };
}
