import { patreonPostId } from '../navigation/watch-page';
import type { WatchPlayback } from '../watch-playback';
import { PATREON_NAVIGATE_EVENT } from './navigation';

/** Open shadow roots only: Mux Player nests its <video> inside mux-video inside its own root. */
function deepVideos(root: ParentNode, found: HTMLVideoElement[] = []): HTMLVideoElement[] {
  if (root instanceof Element && root.shadowRoot) deepVideos(root.shadowRoot, found);
  for (const element of root.querySelectorAll('*')) {
    if (element instanceof HTMLVideoElement) found.push(element);
    if (element.shadowRoot) deepVideos(element.shadowRoot, found);
  }
  return found;
}

const MEDIA_EVENTS = ['loadstart', 'loadeddata', 'durationchange', 'play', 'playing', 'pause', 'waiting', 'emptied', 'ended', 'error', 'abort'];

/**
 * The post's content video: the only video of the only `mux-player` on a post page. Zero or several
 * players (galleries, related posts), live streams and any other playing video fail closed.
 * Embedded iframe players are never visible to this top-document query.
 */
function singleMuxVideo(doc: Document): HTMLVideoElement | null {
  const players = doc.querySelectorAll('mux-player');
  if (players.length !== 1) return null;
  const player = players[0] as HTMLElement & { streamType?: unknown };
  if (/live/i.test(player.getAttribute('stream-type') ?? '') || /live/i.test(String(player.streamType ?? ''))) return null;
  const videos = deepVideos(player);
  if (videos.length !== 1 || videos[0].duration === Infinity) return null;
  if (Array.from(doc.querySelectorAll('video')).some(video => !player.contains(video) && !video.paused)) return null;
  return videos[0];
}

export const patreonWatchPlayback: WatchPlayback = {
  pageIdentity: patreonPostId,
  // Identity is URL-only: Mux Player exposes no cheap, synchronous post id to confirm against.
  mainVideo: singleMuxVideo,
  // The same single-player test already tolerates a hidden or unsized video; the bridge adds
  // the sized, sourced check that entry alone requires.
  preparingVideo: singleMuxVideo,
  refreshEvents: [PATREON_NAVIGATE_EVENT],
  observe(video, onChange) {
    // Media events inside Mux Player's shadow trees do not reach document capture listeners.
    for (const type of MEDIA_EVENTS) video.addEventListener(type, onChange);
    return () => { for (const type of MEDIA_EVENTS) video.removeEventListener(type, onChange); };
  }
};
