import type { HostCaptionLayout } from '../../media-features/types';

/** Painted Disney cue, so the shared dock can lift it above the control bar. */
export function readDisneyHostCaptionLayout(): HostCaptionLayout | null {
  const line = document.querySelector('timed-text-override-region')?.shadowRoot
    ?.querySelector('.hive-subtitle-renderer-line');
  if (!(line instanceof HTMLElement)) return null;
  const rect = line.getBoundingClientRect();
  if (!(rect.width > 1) || !(rect.height > 1)) return null;
  const parsed = Number.parseFloat(getComputedStyle(line).lineHeight);
  const lineHeight = parsed > 0 ? parsed : rect.height;
  const rows = Math.max(1, Math.round(rect.height / lineHeight));
  return {
    width: rect.width,
    height: rect.height,
    lineHeight,
    rows
  };
}
