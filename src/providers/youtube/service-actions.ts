import type { ServiceActionSource } from '../../core/service-actions';
import { mediaProviderIntegrationEnabled, providerOffAttribute } from '../../media-features/provider-flags';
import type { observeProviderDom } from '../dom-watch';
import { isYouTubeHost } from '../hosts';
import {
  nativeServiceActionId, nativeServiceActionSource, serviceActionRoute, serviceControlLabel, servicePlayer,
  usableServiceControl, type NativeServiceActionHooks
} from '../native-service-actions';

import { YOUTUBE_PAGE_EVENTS } from './events';

export const YOUTUBE_PLAYER_SELECTOR = '#movie_player, .html5-video-player';

/** Both the current button and the older desktop/embedded ad control. */
const SKIP_AD = '.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern';

/** YouTube leaves ad controls mounted between ads. A countdown is never an action. */
export function youtubeAdShowing(doc: Document, element?: HTMLElement): boolean {
  return servicePlayer(doc, YOUTUBE_PLAYER_SELECTOR, element)?.classList.contains('ad-showing') === true;
}

/** The runtime lends its element tokens and DOM observation; the source bundles neither. */
export type YouTubeActionHooks = NativeServiceActionHooks & {
  elementToken?: (element: Element) => number;
  observe: typeof observeProviderDom;
};

export function createYouTubeServiceActions(hooks: YouTubeActionHooks): ServiceActionSource {
  const doc = hooks.document ?? document;
  const enabled = hooks.enabled ?? (() => mediaProviderIntegrationEnabled('youtube'));
  const host = hooks.host ?? (() => isYouTubeHost());
  const href = hooks.href ?? (() => window.location.href);
  const source = nativeServiceActionSource(() => {
    if (!enabled() || !host()) return [];
    const root = servicePlayer(doc, YOUTUBE_PLAYER_SELECTOR, hooks.element);
    if (!root?.classList.contains('ad-showing')) return [];
    const route = serviceActionRoute(href(), ['v', 'list', 'index']);
    for (const element of root.querySelectorAll<HTMLElement>(SKIP_AD)) {
      if (!usableServiceControl(element)) continue;
      const label = serviceControlLabel(element);
      if (!label) continue;
      return [{ id: nativeServiceActionId('youtube:skip-ad', route, root, element, hooks.element, hooks.elementToken), label, element }];
    }
    return [];
  });
  const scope = hooks.element?.getRootNode();
  return { ...source, subscribe: changed => hooks.observe({
    root: scope instanceof ShadowRoot ? scope : doc, selector: YOUTUBE_PLAYER_SELECTOR, changed,
    enabled: () => mediaProviderIntegrationEnabled('youtube'),
    events: YOUTUBE_PAGE_EVENTS, flags: [providerOffAttribute('youtube')],
    // The skip button's slot can toggle without any mutation the observer treats as relevant, so
    // the fallback runs while an ad shows; outside ads the player's class change re-arms it.
    needsFallback: () => youtubeAdShowing(doc, hooks.element),
    relevant: record => {
      const element = record.target instanceof Element ? record.target : record.target.parentElement;
      return Boolean(element?.closest(SKIP_AD) || (record.type === 'attributes' && element?.matches(YOUTUBE_PLAYER_SELECTOR))
        || (record.type === 'childList' && [...record.addedNodes, ...record.removedNodes].some(node =>
          node instanceof Element && (node.matches(SKIP_AD) || node.querySelector(SKIP_AD)))));
    }
  }) };
}
