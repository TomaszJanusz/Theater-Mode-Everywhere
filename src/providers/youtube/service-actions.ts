import type { ServiceActionSource } from '../../core/service-actions';
import { mediaProviderIntegrationEnabled, providerOffAttribute } from '../../media-features/provider-flags';
import type { observeProviderDom } from '../dom-watch';
import { isYouTubeHost } from '../hosts';
import {
  nativeServiceActionId, nativeServiceActionSource, serviceActionRoute, serviceControlLabel, servicePlayer,
  usableServiceControl, type NativeServiceActionHooks
} from '../native-service-actions';

import { countdownProgress, readYouTubeAutonav } from './autonav';
import { YOUTUBE_PAGE_EVENTS } from './events';
import { youtubeWatchPlayback } from './watch-playback';

export const YOUTUBE_PLAYER_SELECTOR = '#movie_player, .html5-video-player';

const AUTONAV = '.ytp-autonav-endscreen-countdown-overlay';
/** Both the current button and the older desktop/embedded ad control. */
const SKIP_AD = '.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern';

/** YouTube leaves ad controls mounted between ads. The ad timer is never a skip action. */
export function youtubeAdShowing(doc: Document, element?: HTMLElement): boolean {
  return servicePlayer(doc, YOUTUBE_PLAYER_SELECTOR, element)?.classList.contains('ad-showing') === true;
}

/**
 * The runtime lends its element tokens and DOM observation. Both are required: with the default token the
 * source would count elements in this script's own copy of native-service-actions, apart from the runtime's.
 */
export type YouTubeActionHooks = NativeServiceActionHooks & {
  elementToken: (element: Element) => number;
  observe: typeof observeProviderDom;
};

export function createYouTubeServiceActions(hooks: YouTubeActionHooks): ServiceActionSource {
  const doc = hooks.document ?? document;
  const enabled = hooks.enabled ?? (() => mediaProviderIntegrationEnabled('youtube'));
  const host = hooks.host ?? (() => isYouTubeHost());
  const href = hooks.href ?? (() => window.location.href);
  let visit = 0;
  let navigating = false;
  let maximum = 0;
  let countdownKey = '';
  let activated = false;
  const reset = () => { maximum = 0; countdownKey = ''; activated = false; };
  const countdownActions = (root: HTMLElement, route: string) => {
    const id = youtubeWatchPlayback.pageIdentity(new URL(href()));
    const video = hooks.element instanceof HTMLVideoElement ? hooks.element : root.querySelector('video');
    const countdown = id && !video?.loop && video?.duration !== Infinity && !root.matches('.ytp-live, .ytp-live-dvr')
      && root.closest('ytd-watch-flexy')?.getAttribute('video-id') === id ? readYouTubeAutonav(root) : null;
    if (!countdown) { reset(); return []; }
    const key = nativeServiceActionId('youtube:autonav', route, root, countdown.play, hooks.element, hooks.elementToken) + visit;
    if (key !== countdownKey) { reset(); countdownKey = key; }
    if (activated) return [];
    maximum = Math.max(maximum, countdown.remaining ?? 0);
    return [
      { id: key + ':play', label: serviceControlLabel(countdown.play), element: countdown.play,
        progress: countdownProgress(countdown.remaining, maximum) },
      { id: key + ':cancel', label: serviceControlLabel(countdown.cancel), element: countdown.cancel }
    ];
  };
  const source = nativeServiceActionSource(() => {
    if (!enabled() || !host()) return [];
    const root = servicePlayer(doc, YOUTUBE_PLAYER_SELECTOR, hooks.element);
    if (!root || navigating) return [];
    const route = serviceActionRoute(href(), ['v', 'list', 'index']);
    if (!root.classList.contains('ad-showing')) return countdownActions(root, route);
    reset();
    for (const element of root.querySelectorAll<HTMLElement>(SKIP_AD)) {
      if (!usableServiceControl(element)) continue;
      const label = serviceControlLabel(element);
      if (!label) continue;
      return [{ id: nativeServiceActionId('youtube:skip-ad', route, root, element, hooks.element, hooks.elementToken), label, element }];
    }
    return [];
  });
  const scope = hooks.element?.getRootNode();
  return { ...source,
    activate(id) {
      // A second queued click cannot race the native SPA handover or the native countdown's expiry.
      const success = source.activate(id);
      if (success && id.startsWith(countdownKey) && countdownKey) activated = true;
      return success;
    },
    subscribe: changed => {
      const start = () => { navigating = true; visit++; reset(); changed(); };
      const finish = () => { navigating = false; changed(); };
      doc.addEventListener('yt-navigate-start', start);
      doc.addEventListener('yt-navigate-finish', finish);
      const stop = hooks.observe({
        root: scope instanceof ShadowRoot ? scope : doc, selector: YOUTUBE_PLAYER_SELECTOR, changed,
        enabled,
        events: YOUTUBE_PAGE_EVENTS, flags: [providerOffAttribute('youtube')],
        // The skip button's slot can toggle without any mutation the observer treats as relevant, so
        // the fallback runs while an ad shows; outside ads the player's class change re-arms it.
        needsFallback: () => youtubeAdShowing(doc, hooks.element),
        relevant: record => {
          const element = record.target instanceof Element ? record.target : record.target.parentElement;
          return Boolean(element?.closest(SKIP_AD + ', ' + AUTONAV) || (record.type === 'attributes' && element?.matches(YOUTUBE_PLAYER_SELECTOR))
            || (record.type === 'childList' && [...record.addedNodes, ...record.removedNodes].some(node =>
              node instanceof Element && (node.matches(SKIP_AD + ', ' + AUTONAV) || node.querySelector(SKIP_AD + ', ' + AUTONAV)))));
        }
      });
      return () => {
        stop(); reset(); navigating = true;
        doc.removeEventListener('yt-navigate-start', start);
        doc.removeEventListener('yt-navigate-finish', finish);
      };
    }
  };
}
