import { mediaProviderIntegrationEnabled } from '../../media-features/provider-flags';
import { isYouTubeHost } from '../hosts';
import {
  nativeServiceActionId, nativeServiceActionSource, serviceActionRoute, serviceControlLabel, servicePlayer,
  usableServiceControl, type NativeServiceActionHooks
} from '../native-service-actions';

/** Both the current button and the older desktop/embedded ad control. */
const SKIP_AD = '.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern';

export function createYouTubeServiceActions(hooks: NativeServiceActionHooks = {}) {
  const doc = hooks.document ?? document;
  const enabled = hooks.enabled ?? (() => mediaProviderIntegrationEnabled('youtube'));
  const host = hooks.host ?? (() => isYouTubeHost());
  const href = hooks.href ?? (() => window.location.href);
  return nativeServiceActionSource(() => {
    if (!enabled() || !host()) return [];
    const root = servicePlayer(doc, '#movie_player, .html5-video-player', hooks.element);
    // YouTube leaves ad controls mounted between ads. A countdown is never an action.
    if (!root?.classList.contains('ad-showing')) return [];
    const route = serviceActionRoute(href(), ['v', 'list', 'index']);
    for (const element of root.querySelectorAll<HTMLElement>(SKIP_AD)) {
      if (!usableServiceControl(element)) continue;
      const label = serviceControlLabel(element);
      if (!label) continue;
      return [{ id: nativeServiceActionId('youtube:skip-ad', route, root, element, hooks.element), label, element }];
    }
    return [];
  });
}
