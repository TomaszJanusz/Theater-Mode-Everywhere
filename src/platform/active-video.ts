export function findActiveVideo(root: Document | ShadowRoot): HTMLVideoElement | null {
  if (!root) return null;
  const video = root.querySelector('.theater-everywhere-video-active');
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
