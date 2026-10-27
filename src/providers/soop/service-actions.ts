import type { ServiceAction, ServiceActionSource } from '../../core/service-actions';
import { mediaProviderIntegrationEnabled } from '../../media-features/provider-flags';
import { isSoopHost } from '../hosts';
import { serviceControlLabel, serviceElementToken, usableServiceControl } from '../native-service-actions';
import { SOOP_PLAYER_SELECTOR, soopRoute, soopRouteKey } from '../soop-dom';

const CARD = `${SOOP_PLAYER_SELECTOR} .prev_next_play`;
/** The recording player counts "Play in N sec" down from this many seconds. */
const COUNTDOWN_SECONDS = 5;

export type SoopServiceActionHooks = {
  enabled?: () => boolean;
  host?: () => boolean;
  href?: () => string;
  document?: Document;
};

type LiveAction = ServiceAction & { element: HTMLElement; seconds: number | null };

function secondsLeft(text: string): number | null {
  const left = /(\d{1,2})\s*sec/i.exec(text)?.[1];
  return left === undefined ? null : Math.min(COUNTDOWN_SECONDS, Number(left));
}

/**
 * After a recording the player shows its own "Next video" card and counts down to play it. The
 * card appears only while that countdown runs, so the action exists exactly then: it jumps to the
 * next recording through the card's own link, and the host owns the countdown and its cancel.
 */
export function createSoopServiceActions(hooks: SoopServiceActionHooks = {}): ServiceActionSource {
  const enabled = hooks.enabled ?? (() => mediaProviderIntegrationEnabled('soop'));
  const host = hooks.host ?? (() => isSoopHost());
  const href = hooks.href ?? (() => window.location.href);
  const doc = hooks.document ?? document;

  const live = (): LiveAction[] => {
    if (!enabled() || !host()) return [];
    const route = soopRoute(new URL(href()));
    const link = route?.kind === 'vod' ? doc.querySelector(`${CARD} > a`) : null;
    if (!route || !(link instanceof HTMLElement) || !usableServiceControl(link)) return [];
    const heading = link.querySelector('strong')?.textContent ?? '';
    // The card also shows, hidden, as "Next video" before the countdown starts.
    const seconds = secondsLeft(heading);
    if (seconds === null) return [];
    return [{
      id: `soop:next|${soopRouteKey(route)}|${serviceElementToken(link)}`,
      label: serviceControlLabel(link.querySelector('strong') ?? link),
      progress: 1 - seconds / COUNTDOWN_SECONDS,
      seconds,
      element: link
    }];
  };

  return {
    read: () => live().map(({ element: _element, seconds: _seconds, ...action }) => action),
    readProgress(id) {
      const action = live().find((candidate) => candidate.id === id);
      return action ? action.progress : null;
    },
    activate(id) {
      const action = live().find((candidate) => candidate.id === id);
      if (!action) return false;
      action.element.click();
      return true;
    }
  };
}
