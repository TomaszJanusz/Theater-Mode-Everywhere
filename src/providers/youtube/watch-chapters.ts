import { findYoutubeChapterMarkers, type YoutubeMarker } from '../../media-features/parsers/youtube-chapters';
import { youtubeWatchJsonVideoId } from '../../media-features/parsers/youtube-heatmap';
import { youtubeRecord } from '../../media-features/parsers/youtube-player-response';

/** Videos whose chapters stay known: the current one and a few recent ones, such as a miniplayer's. */
const MAX_REMEMBERED_VIDEOS = 8;

export type WatchChapters = { videoId: string; markers: YoutubeMarker[] };

/**
 * The player-bar chapters in a watch page's data (`yt-navigate-finish` detail `response`), whose `response` is the
 * watch-next response. Only a response naming its video counts; one without chapters says that video has none.
 */
export function navigationChapters(pageData: unknown): WatchChapters | null {
  const response = youtubeRecord(youtubeRecord(pageData)?.response);
  if (!response?.playerOverlays) return null;
  const videoId = youtubeWatchJsonVideoId(response);
  return videoId ? { videoId, markers: findYoutubeChapterMarkers(response) } : null;
}

/** Chapters by video id. ytInitialData describes only a tab's first video; in-app navigation brings the rest. */
export class WatchChapterMemory {
  private readonly byVideo = new Map<string, YoutubeMarker[]>();

  remember(entry: WatchChapters | null): void {
    if (!entry) return;
    this.byVideo.delete(entry.videoId);
    this.byVideo.set(entry.videoId, entry.markers);
    const oldest = this.byVideo.keys().next().value;
    if (this.byVideo.size > MAX_REMEMBERED_VIDEOS && oldest !== undefined) this.byVideo.delete(oldest);
  }

  markers(videoId: string): YoutubeMarker[] | undefined {
    return this.byVideo.get(videoId);
  }
}
