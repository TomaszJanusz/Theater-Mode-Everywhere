import { mediaProviderIntegrationEnabled } from '../../media-features/provider-flags';
import { isYouTubeHost } from '../hosts';
import {
  nativeServiceActionId, nativeServiceActionSource, serviceActionRoute, serviceControlLabel, servicePlayer,
  usableServiceControl, type NativeServiceActionHooks
} from '../native-service-actions';

export const YOUTUBE_PLAYER_SELECTOR = '#movie_player, .html5-video-player';

/** Both the current button and the older desktop/embedded ad control. */
const SKIP_AD = '.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern';

/** YouTube leaves ad controls mounted between ads. A countdown is never an action. */
export function youtubeAdShowing(doc: Document, element?: HTMLElement): boolean {
  return servicePlayer(doc, YOUTUBE_PLAYER_SELECTOR, element)?.classList.contains('ad-showing') === true;
}

export function createYouTubeServiceActions(hooks: NativeServiceActionHooks = {}) {
  const doc = hooks.document ?? document;
  const enabled = hooks.enabled ?? (() => mediaProviderIntegrationEnabled('youtube'));
  const host = hooks.host ?? (() => isYouTubeHost());
  const href = hooks.href ?? (() => window.location.href);
  return nativeServiceActionSource(() => {
    if (!enabled() || !host()) return [];
    const root = servicePlayer(doc, YOUTUBE_PLAYER_SELECTOR, hooks.element);
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
