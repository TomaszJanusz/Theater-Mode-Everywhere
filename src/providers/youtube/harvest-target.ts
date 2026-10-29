import { isYoutubeWatchJsonUrl } from '../../media-features/parsers/youtube-heatmap';
import { isYoutubeTimedtextUrl } from '../../media-features/youtube-caption-url';

/**
 * Timedtext fills the caption cache; watch-page JSON can carry the heatmap. Some host transports construct a
 * Response without a URL: only the Response observers see those, and they never justify a fetch clone.
 */
export function youtubeHarvestTarget(url: string, pageUrl: string): 'timedtext' | 'heatmap' | null {
  if (isYoutubeTimedtextUrl(url, pageUrl)) return 'timedtext';
  return !url || isYoutubeWatchJsonUrl(url, pageUrl) ? 'heatmap' : null;
}
