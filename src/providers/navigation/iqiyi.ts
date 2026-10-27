import { namedControl, type CollectedControl } from './observed';

export const IQIYI_PLAYER_SELECTOR = 'iqpdiv.iqp-player';

/** iq.com has a next-episode control and no previous one. */
export function readIqiyiControls(root: ParentNode): CollectedControl[] {
  return namedControl(root, '[data-player-hook="nextcontrol"], .iqp-btn-next', 'iqiyi', 'next');
}
