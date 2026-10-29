import type { TimelineMarkerSource } from '../../media-features/types';
import { providerRegistry } from '../runtime-registration';

export function createTimelineMarkerSource(video: HTMLElement): TimelineMarkerSource | null {
  for (const hooks of providerRegistry.all()) {
    const source = hooks.timelineMarkers?.(video);
    if (source) return source;
  }
  return null;
}
