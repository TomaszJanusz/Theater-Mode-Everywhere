import { namedControl, type CollectedControl } from '../playlist-controls';

/** Next controls of both players; any mutation inside them can change the step. */
export const TENCENT_NAV_SURFACES = '.txp_btn_next_u, .txp_btn_next, [data-role="wetv-player-ctrl-next"]';

export const TENCENT_PLAYER_SELECTOR = '.txp_player, #internal-player-wrapper';

export function readTencentControls(root: ParentNode): CollectedControl[] {
  const controls = namedControl(
    root,
    '.txp_btn_next_u:not(.txp_none), .txp_btn_next:not(.txp_none), [data-role="wetv-player-ctrl-next"]',
    'tencent',
    'next'
  );
  for (const entry of controls) entry.snapshot.disabled ||= entry.element.matches('.txp_disabled, .txp_none');
  return controls;
}
