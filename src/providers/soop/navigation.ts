import { namedControl, type CollectedControl } from '../playlist-controls';

import { SOOP_PLAYER_SELECTOR } from './dom';


export { SOOP_PLAYER_SELECTOR };

/** Recordings have Previous and Next in the player; the live player has neither. */
export function readSoopControls(root: ParentNode): CollectedControl[] {
  return [
    ...namedControl(root, `${SOOP_PLAYER_SELECTOR} button.play.prev`, 'soop', 'previous'),
    ...namedControl(root, `${SOOP_PLAYER_SELECTOR} button.play.next`, 'soop', 'next')
  ];
}
