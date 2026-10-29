/** MAIN publishes this after harvesting new watch data (captions, heatmap, chapters). */
export const YOUTUBE_HARVEST_EVENT = 'theater-everywhere-youtube-harvest';
/** YouTube's SPA page lifecycle, dispatched on the document. */
export const YOUTUBE_PAGE_EVENTS = ['yt-navigate-start', 'yt-navigate-finish', 'yt-page-data-updated', 'yt-player-updated'] as const;

export const youtubeEvents = {
  navigationStart: ['yt-navigate-start'],
  domChange: YOUTUBE_PAGE_EVENTS,
  media: ['yt-navigate-finish', YOUTUBE_HARVEST_EVENT]
} as const;
