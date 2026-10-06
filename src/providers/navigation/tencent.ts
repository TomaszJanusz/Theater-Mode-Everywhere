import { namedControl, type CollectedControl } from './observed';

export const TENCENT_PLAYER_SELECTOR = '.txp_player, #internal-player-wrapper';

export function readTencentControls(root: ParentNode): CollectedControl[] {
  return namedControl(
    root,
    '.txp_btn_next_u:not(.txp_none), .txp_btn_next:not(.txp_none), [data-role="wetv-player-ctrl-next"]',
    'tencent',
    'next'
  );
}
