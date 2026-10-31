import type { EndScreenSource } from '../../core/end-screen';
import { providerOffAttribute } from '../../media-features/provider-flags';

import { readYouTubeSuggestions, type EndScreenSnapshot, type SuggestionSource } from './end-screen-model';
import { renderEndScreen } from './end-screen-view';
import { youtubeWatchPlayback } from './watch-playback';

const SURFACES = '.ytp-fullscreen-grid, .ytp-autonav-toggle-button';

/** Per-controls lifetime; the player reads no data until its host has actually reached the end. */
export function createYouTubeEndScreen(element: HTMLElement): EndScreenSource & SuggestionSource {
  const doc = element.ownerDocument;
  const root = element.closest<HTMLElement>('#movie_player, .html5-video-player');
  const video = element instanceof HTMLVideoElement ? element : null;
  let disposed = false;
  let navigating = false;
  let visit = 0;
  let snapshot: EndScreenSnapshot | null = null;
  let dirty = true;
  const off = providerOffAttribute('youtube');
  const identity = () => {
    const id = youtubeWatchPlayback.pageIdentity(new URL(doc.location.href));
    return !disposed && !navigating && !doc.documentElement.hasAttribute(off) && root?.isConnected && root.contains(element)
      && root.closest('ytd-watch-flexy')?.getAttribute('video-id') === id ? id : null;
  };
  const hostEndsPlayback = () => Boolean(identity() && root?.classList.contains('ended-mode')
    && (root.querySelector('.ytp-autonav-toggle-button')?.getAttribute('aria-checked') === 'true'
      || root.classList.contains('ytp-autonav-endscreen-upnext-playing')));
  const available = () => identity() && root?.classList.contains('ended-mode')
    && !root.matches('.ad-showing, .ad-interrupting') && !hostEndsPlayback();
  const read = (): EndScreenSnapshot | null => {
    if (!available()) return null;
    const mediaId = JSON.stringify([identity(), visit, video?.currentSrc]);
    if (dirty || snapshot?.mediaId !== mediaId) {
      snapshot = { mediaId, items: readYouTubeSuggestions(root!).map(entry => entry.item) };
      dirty = false;
    }
    return snapshot;
  };
  let stop = () => {};
  let refresh = () => {};
  return {
    mount(container, scope, label) {
      let grid: HTMLElement | null = null;
      let previous: string | undefined;
      const update = () => {
        if (scope.isDisposed) return;
        const key = JSON.stringify(read());
        if (key === previous) return;
        previous = key;
        const focused = grid?.matches(':focus-within');
        grid?.remove();
        grid = renderEndScreen({ read, activate }, label, scope);
        if (grid) container.append(grid);
        if (focused) (grid?.querySelector('button') ?? container.querySelector('button'))?.focus();
      };
      refresh = update;
      scope.add(() => { refresh = () => {}; grid?.remove(); });
      update();
    },
    read, hostEndsPlayback,
    activate,
    subscribe(changed) {
      stop();
      const update = () => { dirty = true; changed(); refresh(); };
      const start = () => { navigating = true; visit++; snapshot = null; update(); };
      const finish = () => { navigating = false; update(); };
      doc.addEventListener('yt-navigate-start', start);
      doc.addEventListener('yt-navigate-finish', finish);
      const state = () => ['ended-mode', 'ad-showing', 'ad-interrupting', 'ytp-autonav-endscreen-upnext-playing']
        .map(flag => root?.classList.contains(flag)).join();
      let playerState = state();
      const observer = new MutationObserver(records => {
        const next = state();
        const playerChanged = next !== playerState;
        playerState = next;
        // Pointer-driven ytp-autohide/style flips are frequent and do not invalidate suggestions.
        if (playerChanged || records.some(record => record.target === doc.documentElement
          || (record.target instanceof Element ? record.target : record.target.parentElement)
            ?.closest(SURFACES)
          || [...record.addedNodes, ...record.removedNodes].some(node => node instanceof Element
            && (node.matches(SURFACES) || node.querySelector(SURFACES))))) update();
      });
      if (root) observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true,
        attributeFilter: ['class', 'href', 'style', 'aria-checked'] });
      observer.observe(doc.documentElement, { attributes: true, attributeFilter: [off] });
      stop = () => {
        observer.disconnect();
        doc.removeEventListener('yt-navigate-start', start);
        doc.removeEventListener('yt-navigate-finish', finish);
      };
      return stop;
    },
    dispose() { disposed = true; snapshot = null; stop(); }
  };

  function activate(id: string, mediaId: string): boolean {
    if (!available() || read()?.mediaId !== mediaId) return false;
    // Never fall back to location.assign: a missing native link degrades without exiting theater.
    const entry = readYouTubeSuggestions(root!).find(entry => entry.item.id === id);
    if (!entry?.anchor.isConnected) return false;
    entry.anchor.click();
    return true;
  }
}
