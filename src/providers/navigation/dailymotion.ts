import { namedControl, type CollectedControl } from './observed';

export function readDailymotionControls(root: ParentNode): CollectedControl[] {
  return [
    ...namedControl(root, '[data-testid="button-previous-video"], button.prev_button', 'dailymotion', 'previous'),
    ...namedControl(root, '[data-testid="button-next-video"], button.next_button', 'dailymotion', 'next')
  ];
}
