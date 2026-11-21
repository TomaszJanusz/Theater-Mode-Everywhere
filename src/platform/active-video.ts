export const THEATER_VIDEO_CLASS = 'theater-everywhere-video-active';
export const THEATER_VIDEO_ATTR = 'data-theater-everywhere';
export const THEATER_VIDEO_SELECTOR = `.${THEATER_VIDEO_CLASS}, [${THEATER_VIDEO_ATTR}]`;
/** Set by the player runtime on every ancestor of the theater element, shadow hosts included. */
export const THEATER_PARENT_CLASS = 'theater-everywhere-parent-active';

/**
 * Finds the marked theater element, entering only the shadow roots of marked ancestors, so a
 * per-key lookup costs the depth of the theater element instead of a walk of the whole page.
 */
export function findMarkedTheaterElement(root: Document | ShadowRoot): Element | null {
  const marked = root.querySelector(THEATER_VIDEO_SELECTOR);
  if (marked) return marked;
  for (const host of root.querySelectorAll(`.${THEATER_PARENT_CLASS}`)) {
    const nested = host.shadowRoot && findMarkedTheaterElement(host.shadowRoot);
    if (nested) return nested;
  }
  return null;
}

export function findActiveVideo(root: Document | ShadowRoot): HTMLVideoElement | null {
  if (!root) return null;
  const video = root.querySelector(THEATER_VIDEO_SELECTOR);
  if (video && video.tagName === 'VIDEO') return video as HTMLVideoElement;

  const hosts = root.querySelectorAll('*');
  for (const host of hosts) {
    if (host instanceof HTMLElement && host.shadowRoot) {
      const nested = findActiveVideo(host.shadowRoot);
      if (nested) return nested;
    }
  }
  return null;
}
