import type { CaptionActivationResult, CaptionTrack, Chapter, MediaCapabilities, MediaFeaturesAdapter } from '../../src/media-features/types';

import type { HostFixture } from './format';

/**
 * The provider contract (`MediaFeaturesAdapter`) answered from a recording, for stories and tests
 * that need realistic provider data without a host. Caption activation has no recorded cues, so it
 * reports the host-delivered outcome a provider returns for a track it renders itself.
 */
export function recordedMediaAdapter(fixture: HostFixture): MediaFeaturesAdapter {
  const media = fixture.media;
  if (!media) throw new Error(`host fixture ${fixture.id} has no recorded media`);
  const source = fixture.service;
  const tracks: CaptionTrack[] = media.captionTracks.map(track => ({ ...track, source, delivery: 'host' }));
  const chapters: Chapter[] = media.chapters.map(chapter => ({ ...chapter, source, confidence: 'high' }));
  return {
    probe: async (): Promise<MediaCapabilities> => ({ captions: tracks.length > 0, chapters: chapters.length > 0, previews: false }),
    listCaptionTracks: async () => tracks.map(track => ({ ...track })),
    activateCaptionTrack: async (id): Promise<CaptionActivationResult> => {
      if (id === null) return { status: 'off', delivery: 'none', cues: [] };
      return tracks.some(track => track.id === id) ? { status: 'active', delivery: 'host', cues: [] } : { status: 'failed', delivery: 'none', cues: [] };
    },
    getChapters: async () => chapters.map(chapter => ({ ...chapter })),
    mediaId: () => media.mediaId,
    getTitle: () => media.title,
    getSubtitle: () => media.subtitle,
    dispose: () => {}
  };
}
