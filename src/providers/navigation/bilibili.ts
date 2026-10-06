import { namedControl, type CollectedControl } from './observed';

export const BILIBILI_PLAYER_SELECTOR = '.bpx-player-container, .bilibili-player, #bilibiliPlayer';

export function readBilibiliControls(root: ParentNode): CollectedControl[] {
  return [
    ...namedControl(root, '.bpx-player-ctrl-prev', 'bilibili', 'previous'),
    ...namedControl(root, '.bpx-player-ctrl-next', 'bilibili', 'next')
  ];
}
