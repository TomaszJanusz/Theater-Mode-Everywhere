import { namedControl, type CollectedControl } from './observed';

/** Watch-page shell. Prev/next live inside it; the same class names exist elsewhere on the site. */
export const DAILYMOTION_PLAYER_SELECTOR = '#player-wrapper';

export function readDailymotionControls(root: ParentNode): CollectedControl[] {
  const player = dailymotionPlayer(root);
  if (!player) return [];
  return [
    ...namedControl(player, '[data-testid="button-previous-video"], button.prev_button', 'dailymotion', 'previous'),
    ...namedControl(player, '[data-testid="button-next-video"], button.next_button', 'dailymotion', 'next')
  ];
}

function dailymotionPlayer(root: ParentNode): ParentNode | null {
  if (root instanceof Element && root.matches(DAILYMOTION_PLAYER_SELECTOR)) return root;
  const found = root.querySelector(DAILYMOTION_PLAYER_SELECTOR);
  return found instanceof HTMLElement ? found : null;
}
