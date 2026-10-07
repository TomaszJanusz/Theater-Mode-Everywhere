import { namedControl, type CollectedControl } from './observed';

export const BILIBILI_INTL_PLAYER_SELECTOR = '.bstar-player';

export function readBilibiliIntlControls(root: ParentNode): CollectedControl[] {
  return namedControl(
    root,
    '.player-mobile-control-btn-next-episode .ip-next-episode',
    'bilibiliIntl',
    'next'
  );
}
