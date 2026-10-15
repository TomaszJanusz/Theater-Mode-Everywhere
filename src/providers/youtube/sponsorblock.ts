import type { TimelineMarker, TimelineMarkerSource } from '../../media-features/types';
import { sponsorBlockMarker } from './sponsorblock-model';

function pageIdentity(): string | null {
  const url = new URL(location.href);
  if (url.pathname === '/watch') return url.searchParams.get('v');
  return /^\/embed\/([^/]+)$/.exec(url.pathname)?.[1] || null;
}

/** SponsorBlock rebuilds direct children in PreviewBar.update()/clear(). It does
 * not mutate li geometry in place, so childList alone is sufficient. */
function readSegments(bar: Element) {
  return Array.from(bar.children).flatMap(child => {
    if (!(child instanceof HTMLElement) || !child.matches('li.previewbar')) return [];
    return [{ left: child.style.left, right: child.style.right,
      category: child.getAttribute('sponsorblock-category') || '', opacity: child.style.opacity }];
  });
}

/** Reads rendered views only: no API, extension messaging, or SponsorBlock logic. */
export function youtubeSponsorBlockSource(video: HTMLElement): TimelineMarkerSource | null {
  if (!/(^|\.)youtube\.com$/.test(location.hostname) || !pageIdentity()) return null;
  const player = video.closest('#movie_player');
  if (!player) return null;
  return {
    observe(publish) {
      let active = true;
      let epoch = 0;
      let pending = false;
      let bar: Element | null = null;
      let identity = pageIdentity();
      let staleBar: Element | null = null;
      let staleContent: string | null = null;
      let lastRawContent: string | null = null;
      let contentKey = '[]';
      let discovering = false;
      let observed: Element | null = null;
      const emit = (markers: readonly TimelineMarker[]) => {
        const key = JSON.stringify(markers);
        if (key === contentKey) return;
        contentKey = key;
        publish(markers);
      };
      const suspend = () => {
        epoch++;
        pending = false;
        observer.disconnect();
        observed = null;
        emit([]);
      };
      const reset = () => {
        if (bar) {
          staleBar = bar;
          staleContent = lastRawContent;
        }
        identity = pageIdentity();
        suspend();
        bar = null;
      };
      const read = () => {
        if (!bar || !bar.isConnected || !player.contains(video)) { emit([]); return; }
        const inputs = readSegments(bar);
        const rawContent = JSON.stringify(inputs);
        if (bar === staleBar && (staleContent === null || rawContent === staleContent)) return;
        lastRawContent = rawContent;
        staleBar = null;
        // One computed-style read per rebuild; all categories share this palette.
        const palette = getComputedStyle(document.documentElement);
        const colors = new Map<string, { color: string; textColor?: string }>();
        const markers: TimelineMarker[] = [];
        for (const input of inputs) {
          let colorsForCategory = colors.get(input.category);
          if (!colorsForCategory) {
            const color = palette.getPropertyValue(`--sb-category-${input.category}`).trim();
            const textColor = palette.getPropertyValue(`--sb-category-text-${input.category}`).trim();
            colorsForCategory = { color: CSS.supports('color', color) ? color : '',
              ...(CSS.supports('color', textColor) ? { textColor } : {}) };
            colors.set(input.category, colorsForCategory);
          }
          const marker = sponsorBlockMarker({ ...input, color: colorsForCategory.color });
          if (marker) markers.push({ ...marker, ...(colorsForCategory.textColor ? { textColor: colorsForCategory.textColor } : {}) });
        }
        emit(markers);
      };
      const scheduleRead = () => {
        if (pending || !active || document.hidden) return;
        pending = true;
        const scheduledEpoch = epoch;
        queueMicrotask(() => {
          if (!active || document.hidden || scheduledEpoch !== epoch) return;
          pending = false;
          if (identity !== pageIdentity()) { reset(); return; }
          read();
        });
      };
      const bind = () => {
        if (!active || document.hidden) return;
        if (identity !== pageIdentity()) reset();
        if (!pageIdentity() || !player.contains(video)) return;
        // Only desktop YouTube/embeds; these are the upstream attach points.
        const progress = player.querySelector('.ytp-progress-bar, .ytp-progress-list');
        if (!progress) return;
        const next = progress.querySelector(':scope > ul#previewbar');
        if (next && next === bar && observed === bar && !discovering) { scheduleRead(); return; }
        epoch++;
        pending = false;
        observer.disconnect();
        bar = next;
        discovering = !bar;
        // No subtree or attributes: wait shallowly for insertion, then observe
        // only SponsorBlock's container. Never watch the document/player tree.
        observed = bar || progress;
        observer.observe(observed, { childList: true });
        if (bar) scheduleRead();
      };
      const observer = new MutationObserver(() => {
        if (!active || document.hidden) return;
        if (discovering) bind();
        else {
          // A rebuild of the same container after navigation is a new view.
          staleBar = null;
          scheduleRead();
        }
      });
      const visibility = () => {
        if (document.hidden) suspend();
        else bind();
      };
      const navigationEvents = ['yt-navigate-finish', 'yt-page-data-updated', 'yt-player-updated'];
      for (const event of navigationEvents) {
        window.addEventListener(event, bind);
        document.addEventListener(event, bind);
      }
      window.addEventListener('yt-navigate-start', reset);
      document.addEventListener('yt-navigate-start', reset);
      document.addEventListener('visibilitychange', visibility);
      video.addEventListener('emptied', reset);
      video.addEventListener('loadedmetadata', bind);
      video.addEventListener('durationchange', bind);
      bind();
      return () => {
        if (!active) return;
        active = false;
        suspend();
        for (const event of navigationEvents) {
          window.removeEventListener(event, bind);
          document.removeEventListener(event, bind);
        }
        window.removeEventListener('yt-navigate-start', reset);
        document.removeEventListener('yt-navigate-start', reset);
        document.removeEventListener('visibilitychange', visibility);
        video.removeEventListener('emptied', reset);
        video.removeEventListener('loadedmetadata', bind);
        video.removeEventListener('durationchange', bind);
      };
    }
  };
}
