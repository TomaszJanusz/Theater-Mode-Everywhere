import { selectedIqiyiEpisode } from './dom';
import { collectElement, namedControl, type CollectedControl } from '../playlist-controls';

const NEXT = '[data-player-hook="nextcontrol"], .iqp-btn-next';

/**
 * Next is the player's own control. The player has no previous control, so Previous is the episode
 * before the highlighted one in the host's episode list, skipping the list's trailer entries; the
 * host's own link performs the navigation.
 */
export function readIqiyiControls(root: ParentNode): CollectedControl[] {
  const controls = namedControl(root, NEXT, 'iqiyi', 'next');
  const doc = root instanceof Document ? root : root.ownerDocument;
  let item = doc ? selectedIqiyiEpisode(doc)?.previousElementSibling : null;
  while (item?.querySelector('a[rseat="trailer"]')) item = item.previousElementSibling;
  const link = item?.querySelector('a[href]');
  return link instanceof HTMLElement
    ? [...controls, collectElement(link, 'iqiyi', 'previous', () => ({ preview: null, restarts: false }))]
    : controls;
}
