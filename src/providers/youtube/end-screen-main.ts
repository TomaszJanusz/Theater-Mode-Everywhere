import { mediaProviderIntegrationEnabled } from '../../media-features/provider-flags';
import { publishHiddenJson } from '../../platform/hidden-json';
import { isYouTubeHost } from '../hosts';

import { END_CHANNELS_QUERY, END_CHANNELS_REPLY, type YouTubeEndChannelsReply } from './end-screen-bridge';
import { youtubeEndScreenChannels } from './owner-main';

let installed = false;

/** Answers the isolated end screen on demand, from the watch-next responses MAIN already holds; nothing polls here. */
export function installEndScreenChannels(responses: () => readonly unknown[]): void {
  if (installed || !isYouTubeHost()) return;
  installed = true;
  window.addEventListener(END_CHANNELS_QUERY, (event: Event) => {
    const detail = (event as CustomEvent<unknown>).detail;
    if (typeof detail !== 'string' || detail.length > 200) return;
    try {
      const { requestId, videoId } = JSON.parse(detail) as { requestId?: unknown; videoId?: unknown };
      if (typeof requestId !== 'string' || typeof videoId !== 'string') return;
      const channels = mediaProviderIntegrationEnabled('youtube') ? youtubeEndScreenChannels(videoId, responses()) : [];
      const reply: YouTubeEndChannelsReply = { requestId, pageHref: window.location.href, videoId, channels };
      publishHiddenJson(END_CHANNELS_REPLY, reply);
    } catch { /* Host properties can throw or disappear during SPA navigation. */ }
  });
}
