import { usableServiceControl } from '../native-service-actions';

export const BILIBILI_ENDING_PANEL = '.bpx-player-ending-panel';
export const BILIBILI_END_TILE = `${BILIBILI_ENDING_PANEL} .bpx-player-ending-related-item`;

/**
 * Recorded DOM: when the viewer's autoplay is on, Bilibili's first ending tile (its next item) carries a running ring
 * and a cancel control. Bilibili owns the countdown, its cancellation and the navigation; the ring has no readable
 * progress. Cancelling or autoplay being off hides both inline, which is the setting as it applies to this end.
 * A part or series item that follows switches at once and never shows this panel.
 */
export function readBilibiliAutoplay(root: ParentNode) {
  const play = root.querySelector<HTMLElement>(BILIBILI_END_TILE);
  const countdown = play?.querySelector<HTMLElement>('.bpx-player-ending-related-item-countdown');
  const cancel = play?.querySelector<HTMLElement>('.bpx-player-ending-related-item-cancel');
  if (!play || !countdown || !cancel || !usableServiceControl(countdown) || !usableServiceControl(cancel)) return null;
  return { play, cancel, title: play.querySelector('.bpx-player-ending-related-item-title')?.textContent ?? '' };
}
