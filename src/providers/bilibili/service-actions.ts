import { mediaProviderIntegrationEnabled } from '../../media-features/provider-flags';
import { isBilibiliHost } from '../hosts';
import { BILIBILI_PLAYER_SELECTOR } from '../navigation/bilibili';
import {
  nativeServiceActionId, nativeServiceActionSource, serviceActionRoute, serviceControlLabel, servicePlayer,
  usableServiceControl, type NativeServiceActionHooks
} from '../native-service-actions';

/** Toast confirmations also serve login and purchases; expose only known skip actions. */
const CONFIRM = '.bpx-player-toast-row.bpx-player-toast-unfold .bpx-player-toast-confirm';
const SKIP_CONFIRMATIONS = new Set(['不跳过', '仍然跳过', '不跳過', '仍然跳過']);

export function createBilibiliServiceActions(hooks: NativeServiceActionHooks = {}) {
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
      if (!usableServiceControl(element)) return [];
      const label = serviceControlLabel(element);
      return SKIP_CONFIRMATIONS.has(label) ? [{ id: nativeServiceActionId('bilibili:confirm', route, root, element, hooks.element), label, element }] : [];
    });
  });
}
