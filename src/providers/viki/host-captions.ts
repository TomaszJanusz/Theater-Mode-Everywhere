import type { HostCaptionLayout } from '../../media-features/types';

import { VIKI_THEATER_STAGE_CLASS } from './stage';

const CUE_SELECTOR = '.vjs-text-track-display .vjs-text-track-cue';

/**
 * Painted Viki cues, so the shared dock can lift them above the control bar.
 * Only measured while the stage lift is active: outside it the display sits in
 * the collapsed player and its geometry is meaningless.
 */
export function readVikiCaptionLayout(): HostCaptionLayout | null {
  if (!document.documentElement.classList.contains(VIKI_THEATER_STAGE_CLASS)) return null;
  let width = 0;
  let height = 0;
  for (const cue of document.querySelectorAll(CUE_SELECTOR)) {
    const rect = cue.getBoundingClientRect();
    if (rect.width <= 1 || rect.height <= 1) continue;
    width = Math.max(width, rect.width);
    height += rect.height;
  }
  return width > 0 ? { width, height } : null;
}
