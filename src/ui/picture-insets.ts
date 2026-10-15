import { pictureEdgeInsets, resolveVideoFitMode } from './appearance';

/**
 * Space between the viewport edges and the picture the host draws inside `element`.
 * Fit and position come from the custom properties the picture layout writes on the
 * element, so this reads the settled target rather than a mid-transition frame.
 */
export function viewportPictureInsets(element: HTMLElement): { end: number; bottom: number } | null {
  const box = element.getBoundingClientRect();
  if (!(box.width > 0 && box.height > 0)) return null;
  const media = element instanceof HTMLVideoElement ? element : null;
  const insets = pictureEdgeInsets(
    {
      videoWidth: media?.videoWidth ?? 0,
      videoHeight: media?.videoHeight ?? 0,
      viewportWidth: box.width,
      viewportHeight: box.height
    },
    resolveVideoFitMode(element.style.getPropertyValue('--theater-object-fit')),
    element.style.getPropertyValue('--theater-object-position')
  );
  const root = document.documentElement;
  return { end: root.clientWidth - box.right + insets.end, bottom: root.clientHeight - box.bottom + insets.bottom };
}

/**
 * Calls `notify` once per frame when the box, the media size or the layout's custom
 * properties may have moved the picture. Returns its cleanup.
 */
export function observePicture(element: HTMLElement, notify: () => void): () => void {
  let frame = 0;
  const schedule = () => {
    if (frame) return;
    frame = window.requestAnimationFrame(() => { frame = 0; notify(); });
  };
  const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
  resize?.observe(element);
  // Hosts may restyle the element often; only the layout's own properties move the picture.
  const layoutKey = () => `${element.style.getPropertyValue('--theater-object-fit')}|${element.style.getPropertyValue('--theater-object-position')}`;
  let lastKey = layoutKey();
  const style = new MutationObserver(() => {
    const key = layoutKey();
    if (key === lastKey) return;
    lastKey = key;
    schedule();
  });
  style.observe(element, { attributes: true, attributeFilter: ['style'] });
  element.addEventListener('loadedmetadata', schedule);
  element.addEventListener('resize', schedule);
  return () => {
    window.cancelAnimationFrame(frame);
    frame = 0;
    resize?.disconnect();
    style.disconnect();
    element.removeEventListener('loadedmetadata', schedule);
    element.removeEventListener('resize', schedule);
  };
}
