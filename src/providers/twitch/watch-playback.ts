import type { WatchPlayback } from '../watch-playback';

import { twitchLoadedChannel, twitchMediaPlayer, twitchPlayingBroadcast, twitchShowsAd } from './media-player';
import { TWITCH_NAVIGATE_EVENT } from './navigation';
import { twitchChannelSegment } from './routes';

const LIVE = 'live:';
/**
 * Twitch's content classification gate ("Start Watching"), shown over mature streams and VODs until the
 * viewer accepts it. The stream already plays muted behind it, but it is not being watched yet.
 */
const GATE_SELECTOR = '[data-a-target="content-classification-gate-overlay"]';

const overlay = (video: HTMLVideoElement, selector: string): boolean => Boolean(video.closest('.video-player')?.querySelector(selector));

/**
 * A past broadcast (`/videos/<id>`, identified by its id) or a channel page (`/<login>`, `live:<login>`).
 * The query string never matters. Clips, `/<login>/videos` and other channel tabs, Twitch's own routes
 * (`/directory`, `/moderator/…`, `/popout/…`), the front page, the mobile site and embeds stay manual.
 */
export function twitchWatchIdentity(url: URL): string | null {
  if (url.hostname !== 'www.twitch.tv' && url.hostname !== 'twitch.tv') return null;
  const vod = /^\/videos\/(\d+)\/?$/.exec(url.pathname)?.[1];
  if (vod) return vod;
  const segment = /^\/([^/]+)\/?$/.exec(url.pathname)?.[1];
  const channel = segment ? twitchChannelSegment(segment) : null;
  return channel ? `${LIVE}${channel}` : null;
}

/** The page's only player video. Hover previews, the mini player and any second video fail closed. */
function singlePlayerVideo(doc: Document): HTMLVideoElement | null {
  const videos = doc.querySelectorAll<HTMLVideoElement>('[data-a-target="video-ref"] video');
  return videos.length === 1 && doc.querySelectorAll('video').length === 1 ? videos[0] : null;
}

/**
 * A VOD's identity is URL-only: the player exposes no cheap, synchronous VOD id to confirm against. A
 * live stream reports an infinite duration, which rejects the previous channel's video during SPA entry.
 */
function vodVideo(doc: Document): HTMLVideoElement | null {
  const video = singlePlayerVideo(doc);
  return video && video.duration !== Infinity ? video : null;
}

/**
 * The channel page's player, only once Twitch's media player reports the URL's channel live. After SPA
 * navigation the previous channel's stream keeps playing on the same element for a few seconds, and an
 * offline channel's page autoplays a past broadcast (finite duration, no channel) instead. `loading` also
 * accepts a stream whose duration is not known yet.
 */
function liveVideo(doc: Document, channel: string, loading: boolean): HTMLVideoElement | null {
  const video = singlePlayerVideo(doc);
  if (!video || !(video.duration === Infinity || (loading && Number.isNaN(video.duration)))) return null;
  const player = twitchMediaPlayer(video);
  return player && twitchLoadedChannel(player) === channel ? video : null;
}

const liveChannel = (identity: string): string | null => identity.startsWith(LIVE) ? identity.slice(LIVE.length) : null;

function watchedVideo(doc: Document, identity: string, loading: boolean): HTMLVideoElement | null {
  const channel = liveChannel(identity);
  return channel ? liveVideo(doc, channel, loading) : vodVideo(doc);
}

/** Automatic entry and its countdown wait behind the content classification gate; a manual session's replacement does not. */
function ungated(video: HTMLVideoElement | null): HTMLVideoElement | null {
  return video && !overlay(video, GATE_SELECTOR) ? video : null;
}

/** Ads stitched into a VOD or live stream play in the same element and stay part of the watch session, as on Netflix and Disney+. */
export const twitchWatchPlayback: WatchPlayback = {
  pageIdentity: twitchWatchIdentity,
  mainVideo(doc, identity, purpose) {
    return purpose === 'replacement' ? watchedVideo(doc, identity, true) : ungated(watchedVideo(doc, identity, false));
  },
  preparingVideo: (doc, identity) => ungated(watchedVideo(doc, identity, true)),
  // Accepting the gate fires no media event: the playing stream only unmutes. Watch the player for the
  // gate coming or going while an entry is still possible; other overlay churn costs one query.
  observe(video, onChange) {
    const player = video.closest('.video-player');
    if (!player) return null;
    let gated = overlay(video, GATE_SELECTOR);
    const observer = new MutationObserver(() => {
      if (overlay(video, GATE_SELECTOR) === gated) return;
      gated = !gated;
      onChange();
    });
    observer.observe(player, { childList: true, subtree: true });
    return () => observer.disconnect();
  },
  // A channel that goes offline and live again on the same page is a new broadcast. Unknown during ads,
  // so an ad break can never look like one.
  contentIdentity(video, identity) {
    if (!liveChannel(identity) || twitchShowsAd(video)) return null;
    const player = twitchMediaPlayer(video);
    return player && twitchPlayingBroadcast(player);
  },
  refreshEvents: [TWITCH_NAVIGATE_EVENT]
};
