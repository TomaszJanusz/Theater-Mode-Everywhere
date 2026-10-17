import { mountPlayerUi } from './root';
import { isElementMotionReduced } from './spinner-exit';

export const AUTO_THEATER_SCRIM_CLASS = 'theater-auto-scrim';
const FADE_MS = 180;

export type AutoTheaterScrimOptions = {
  /** The content video the countdown is about; its box stays uncovered. */
  video(): HTMLVideoElement | null;
  theaterActive(): boolean;
};

/**
 * Backdrop for the countdown while the host page is still settling: it dims the loading page chrome
 * and leaves the video's own box clear. It is purely visual (aria-hidden, no pointer events, no focus)
 * and lives and dies with the notice. The cut-out is re-read only on resize, scroll and video resize,
 * coalesced to one frame; nothing runs per frame. Returns cleanup: it fades out, except when theater
 * opened in the same task, where the theater video already covers the viewport and the scrim is dropped
 * at once so nothing is darkened twice.
 */
export function showAutoTheaterScrim(options: AutoTheaterScrimOptions): () => void {
  const scrim = document.createElement('div');
  scrim.className = AUTO_THEATER_SCRIM_CLASS;
  scrim.setAttribute('aria-hidden', 'true');
  mountPlayerUi(scrim);

  let frame: number | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let observed: HTMLVideoElement | null = null;
  const layout = (): void => {
    frame = undefined;
    const video = options.video();
    if (video !== observed) {
      if (observed) resizeObserver?.unobserve(observed);
      observed = video;
      if (video) resizeObserver?.observe(video);
    }
    const rect = video?.isConnected ? video.getBoundingClientRect() : null;
    const visible = rect && rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0
      && rect.top < window.innerHeight && rect.left < window.innerWidth;
    if (!rect || !visible) {
      scrim.style.removeProperty('clip-path');
      return;
    }
    // Even-odd polygon: the viewport minus the video's box.
    const { left, top, right, bottom } = rect;
    scrim.style.setProperty('clip-path',
      `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${left}px ${top}px, ${right}px ${top}px, ${right}px ${bottom}px, ${left}px ${bottom}px, ${left}px ${top}px)`);
  };
  const schedule = (): void => {
    if (frame === undefined) frame = requestAnimationFrame(layout);
  };
  resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : undefined;
  window.addEventListener('resize', schedule);
  window.addEventListener('scroll', schedule, { capture: true, passive: true });
  layout();

  let released = false;
  return () => {
    if (released) return;
    released = true;
    window.removeEventListener('resize', schedule);
    window.removeEventListener('scroll', schedule, true);
    resizeObserver?.disconnect();
    if (frame !== undefined) cancelAnimationFrame(frame);
    // Entry runs right after the intent hides the notice, in the same task.
    queueMicrotask(() => {
      if (options.theaterActive() || isElementMotionReduced(scrim)) {
        scrim.remove();
        return;
      }
      scrim.classList.add('leaving');
      const remove = (): void => scrim.remove();
      scrim.addEventListener('transitionend', remove, { once: true });
      // Hidden tabs and interrupted transitions never fire transitionend.
      window.setTimeout(remove, FADE_MS + 100);
    });
  };
}
