import type { YouTubeSuggestionChannel } from './owner-main';

export const END_CHANNELS_QUERY = 'theater-everywhere-youtube-end-channels-query';
export const END_CHANNELS_REPLY = 'theater-everywhere-youtube-end-channels';

/** What MAIN publishes for one query: the channels of the suggestions shown when `videoId` ends, on the page it read. */
export type YouTubeEndChannelsReply = { requestId: string; pageHref: string; videoId: string; channels: YouTubeSuggestionChannel[] };

/** A couple of dozen names and paths; anything larger is not an end screen. */
const MAX_REPLY_CHARS = 20_000;
let requestCounter = 0;

/**
 * The suggestions' channels by video id. Strings cross Firefox's MAIN/isolated-world boundary without object access
 * errors; MAIN answers synchronously inside the dispatch, and a reply for another request, page or video is dropped.
 * Only the shape is checked here: the end-screen model admits a channel link by name and host.
 */
export function queryYouTubeEndChannels(doc: Document, videoId: string): Map<string, YouTubeSuggestionChannel> {
  const channels = new Map<string, YouTubeSuggestionChannel>();
  const view = doc.defaultView;
  if (!view) return channels;
  const requestId = `${Date.now()}:${++requestCounter}`;
  view.dispatchEvent(new CustomEvent(END_CHANNELS_QUERY, { detail: JSON.stringify({ requestId, videoId }) }));
  const node = doc.getElementById(END_CHANNELS_REPLY);
  const text = node?.textContent;
  node?.remove();
  if (!text || text.length > MAX_REPLY_CHARS) return channels;
  try {
    const reply = JSON.parse(text) as Partial<YouTubeEndChannelsReply> | null;
    if (!reply || reply.requestId !== requestId || reply.pageHref !== view.location.href || reply.videoId !== videoId
      || !Array.isArray(reply.channels)) return channels;
    for (const channel of reply.channels as unknown[]) {
      const { videoId: id, name, url } = (channel ?? {}) as Partial<YouTubeSuggestionChannel>;
      if (typeof id === 'string' && typeof name === 'string' && typeof url === 'string') channels.set(id, { videoId: id, name, url });
    }
  } catch { /* A malformed reply links no channel. */ }
  return channels;
}
