export const THEATER_VIDEO_CLASS = 'theater-everywhere-video-active';
export const THEATER_VIDEO_ATTR = 'data-theater-everywhere';
export const THEATER_VIDEO_SELECTOR = `.${THEATER_VIDEO_CLASS}, [${THEATER_VIDEO_ATTR}]`;

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
