import { mediaProviderIntegrationEnabled } from '../../media-features/provider-flags';
import {
  nativeServiceActionId, nativeServiceActionSource, serviceActionRoute, serviceControlLabel, servicePlayer,
  usableServiceControl, type NativeServiceActionHooks
} from '../native-service-actions';

import { isBilibiliHost } from './hosts';
import { BILIBILI_PLAYER_SELECTOR } from './navigation';

/** Toast confirmations also serve login and purchases; expose only known skip actions. */
const CONFIRM = '.bpx-player-toast-row.bpx-player-toast-unfold .bpx-player-toast-confirm';
const SKIP_CONFIRMATIONS = new Set(['不跳过', '仍然跳过', '不跳過', '仍然跳過']);

/** A registered provider passes the runtime's lent `serviceElementToken` as `elementToken` rather than bundling a second counter. */
export function createBilibiliServiceActions(hooks: NativeServiceActionHooks & { elementToken?: (element: Element) => number } = {}) {
  const doc = hooks.document ?? document;
  const enabled = hooks.enabled ?? (() => mediaProviderIntegrationEnabled('bilibili'));
  const host = hooks.host ?? (() => isBilibiliHost());
  const href = hooks.href ?? (() => window.location.href);
  return nativeServiceActionSource(() => {
    if (!enabled() || !host()) return [];
    const root = servicePlayer(doc, BILIBILI_PLAYER_SELECTOR, hooks.element);
    if (!root) return [];
    const route = serviceActionRoute(href(), ['p']);
    return Array.from(root.querySelectorAll<HTMLElement>(CONFIRM)).flatMap(element => {
      // Bilibili marks unavailable player controls with its own state class.
      if (!usableServiceControl(element) || element.closest('.bpx-state-disabled')) return [];
      const label = serviceControlLabel(element);
      return SKIP_CONFIRMATIONS.has(label) ? [{ id: nativeServiceActionId('bilibili:confirm', route, root, element, hooks.element, hooks.elementToken), label, element }] : [];
    });
  });
}
