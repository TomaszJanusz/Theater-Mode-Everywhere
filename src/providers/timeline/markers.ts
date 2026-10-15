import type { TimelineMarkerSource } from '../../media-features/types';
import { youtubeSponsorBlockSource } from '../youtube/sponsorblock';

export function createTimelineMarkerSource(video: HTMLElement): TimelineMarkerSource | null {
  return youtubeSponsorBlockSource(video);
}
