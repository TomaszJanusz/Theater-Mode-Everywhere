/**
 * Bitmovin paints cues at `.bitmovinplayer-container > div:last-child > div > ul`.
 * That wrapper is position:absolute and the list's z-index is auto, so theater's
 * fixed video (z-index 2147483647) covers the text. The lift is the YouTube
 * caption-window pattern: a theater-only stylesheet rule, removed by dropping
 * this class. No other player class is targeted.
 */
export const CRUNCHYROLL_HOST_CAPTION_CLASS = 'theater-everywhere-crunchyroll-host-captions';
export const CRUNCHYROLL_HOST_CAPTION_SELECTOR = '.bitmovinplayer-container > div:last-child > div > ul';

export function readCrunchyrollHostCaptionLayout(): HostCaptionLayout | null {
  const html = document.documentElement;
  if (!html.classList.contains('theater-everywhere-html-active')
    || !html.classList.contains(CRUNCHYROLL_HOST_CAPTION_CLASS)) return null;
  const host = document.querySelector(CRUNCHYROLL_HOST_CAPTION_SELECTOR);
  return host instanceof HTMLElement && host.offsetWidth > 1 && host.offsetHeight > 1
    ? { width: host.offsetWidth, height: host.offsetHeight } : null;
}

export function retainCrunchyrollHostCaptionSurface(): void {
  document.documentElement?.classList?.add(CRUNCHYROLL_HOST_CAPTION_CLASS);
}

export function releaseCrunchyrollHostCaptionSurface(): void {
  document.documentElement?.classList?.remove(CRUNCHYROLL_HOST_CAPTION_CLASS);
}
import type { HostCaptionLayout } from '../../media-features/types';
