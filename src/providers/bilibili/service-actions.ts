import { mediaProviderIntegrationEnabled } from '../../media-features/provider-flags';
import {
  nativeServiceActionId, nativeServiceActionSource, serviceActionRoute, serviceControlLabel, servicePlayer,
  usableServiceControl, type NativeServiceActionHooks
} from '../native-service-actions';

import { readBilibiliAutoplay } from './autoplay';
import { isBilibiliHost } from './hosts';
import { BILIBILI_PLAYER_SELECTOR } from './navigation';
import { bilibiliVideoIdentity } from './watch-playback';

/** Toast confirmations also serve login and purchases; expose only known skip actions. */
const CONFIRM = '.bpx-player-toast-row.bpx-player-toast-unfold .bpx-player-toast-confirm';
const SKIP_CONFIRMATIONS = new Set(['不跳过', '仍然跳过', '不跳過', '仍然跳過']);

/** A registered provider passes the runtime's lent `serviceElementToken` as `elementToken` rather than bundling a second counter. */
export function createBilibiliServiceActions(
  hooks: NativeServiceActionHooks & { elementToken?: (element: Element) => number; label?: (key: 'nextVideo') => string } = {}
) {
  const doc = hooks.document ?? document;
  const enabled = hooks.enabled ?? (() => mediaProviderIntegrationEnabled('bilibili'));
  const host = hooks.host ?? (() => isBilibiliHost());
  const href = hooks.href ?? (() => window.location.href);
  let countdownKey = '';
  let activated = false;
  const countdownActions = (root: HTMLElement, route: string) => {
    const countdown = bilibiliVideoIdentity(new URL(href())) ? readBilibiliAutoplay(root) : null;
    if (!countdown) { countdownKey = ''; activated = false; return []; }
    const key = nativeServiceActionId('bilibili:autoplay', route, root, countdown.play, hooks.element, hooks.elementToken);
    if (key !== countdownKey) { countdownKey = key; activated = false; }
    // A second queued click cannot race Bilibili's own switch or the countdown's expiry.
    return activated ? [] : [
      { id: key + ':play', label: hooks.label?.('nextVideo') || serviceControlLabel(countdown.play.querySelector<HTMLElement>('.bpx-player-ending-related-item-title') ?? countdown.play), element: countdown.play },
      { id: key + ':cancel', label: serviceControlLabel(countdown.cancel), element: countdown.cancel }
    ];
  };
  const source = nativeServiceActionSource(() => {
    if (!enabled() || !host()) return [];
    const root = servicePlayer(doc, BILIBILI_PLAYER_SELECTOR, hooks.element);
    if (!root) return [];
    const route = serviceActionRoute(href(), ['p']);
    const autoplay = countdownActions(root, route);
    if (autoplay.length) return autoplay;
    return Array.from(root.querySelectorAll<HTMLElement>(CONFIRM)).flatMap(element => {
      // Bilibili marks unavailable player controls with its own state class.
      if (!usableServiceControl(element) || element.closest('.bpx-state-disabled')) return [];
      const label = serviceControlLabel(element);
      return SKIP_CONFIRMATIONS.has(label) ? [{ id: nativeServiceActionId('bilibili:confirm', route, root, element, hooks.element, hooks.elementToken), label, element }] : [];
    });
  });
  return { ...source, activate(id: string) {
    const success = source.activate(id);
    if (success && countdownKey && id.startsWith(countdownKey) && id.endsWith(':play')) activated = true;
    return success;
  } };
}
