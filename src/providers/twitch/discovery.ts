import { isTwitchHost } from './hosts';

/**
 * Reloading the player (error recovery, "Click Here to Reload Player") can mount a new `<video>` and
 * leave the old one connected but emptied. The old element will never play again, so the session
 * must move to the replacement instead of waiting for a disconnect that does not come. A video that
 * is merely loading (`NETWORK_LOADING`, or idle with a source) is not abandoned.
 */
export function twitchVideoAbandoned(video: HTMLVideoElement): boolean {
  return isTwitchHost() && Boolean(video.closest('[data-a-target="video-ref"]'))
    && video.readyState === HTMLMediaElement.HAVE_NOTHING
    && (video.networkState === HTMLMediaElement.NETWORK_EMPTY
      || video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE
      || Boolean(video.error));
}
