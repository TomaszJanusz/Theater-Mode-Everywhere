import type { PlaybackEndSource } from '../../core/end-screen';
import { mediaProviderIntegrationEnabled, providerOffAttribute } from '../../media-features/provider-flags';

import { YOUTUBE_PLAYER_SELECTOR } from './navigation';
import { youtubeContentEnded } from './playback-end-model';
import { youtubeWatchPlayback } from './watch-playback';

/** Isolated DOM knowledge: a post-roll can empty the video without ever firing its content's ended event. */
export function createYouTubePlaybackEnd(element: HTMLElement): PlaybackEndSource | undefined {
  const root = element.closest<HTMLElement>(YOUTUBE_PLAYER_SELECTOR);
  if (!root || !(element instanceof HTMLVideoElement)) return undefined;
  const doc = element.ownerDocument;
  let navigating = false;
  const ended = (): boolean | null => {
    if (!mediaProviderIntegrationEnabled('youtube')) return null;
    const url = new URL(doc.location.href);
    const id = youtubeWatchPlayback.pageIdentity(url);
    // Unsupported surfaces (including embeds) retain the generic native-ended fallback. Shorts never end.
    if (!id) return url.pathname.startsWith('/shorts/') ? false : null;
    if (navigating || !root.isConnected || !root.contains(element)
      || root.closest('ytd-watch-flexy')?.getAttribute('video-id') !== id) return false;
    return youtubeContentEnded(root.className, element.loop, element.duration);
  };
  return {
    ended,
    observe(changed) {
      const start = () => { navigating = true; changed(); };
      const finish = () => { navigating = false; changed(); };
      let previous = ended();
      const observer = new MutationObserver(() => {
        const next = ended();
        if (next !== previous) { previous = next; changed(); }
      });
      observer.observe(root, { attributes: true, attributeFilter: ['class'] });
      const watch = root.closest('ytd-watch-flexy');
      if (watch) observer.observe(watch, { attributes: true, attributeFilter: ['video-id'] });
      observer.observe(element, { attributes: true, attributeFilter: ['loop'] });
      observer.observe(doc.documentElement, { attributes: true, attributeFilter: [providerOffAttribute('youtube')] });
      doc.addEventListener('yt-navigate-start', start);
      doc.addEventListener('yt-navigate-finish', finish);
      return () => {
        navigating = true;
        observer.disconnect();
        doc.removeEventListener('yt-navigate-start', start);
        doc.removeEventListener('yt-navigate-finish', finish);
      };
    }
  };
}
