import { netflixVideoId } from '../../media-features/parsers/netflix-page';
import { mediaProviderIntegrationEnabled } from '../../media-features/provider-flags';
import { isNetflixHost } from '../hosts';
import { netflixWatchId } from './session';
import { readNetflixTimedAction, requestNetflixTimedAction } from './action-bridge';

/**
 * Bounded watch-player controls. Stage CSS hides host chrome with visibility,
 * opacity, and pointer-events, so those states stay actionable. display:none,
 * a disabled control, and a disconnected node do not.
 * The id binds data-videoid, the /watch path, and a per-element token so a
 * replaced button or a new title cannot be activated by a stale id.
 */
const NETFLIX_ACTIONS = [
  { uia: 'player-skip-intro', kind: 'skip-intro' },
  { uia: 'player-skip-recap', kind: 'skip-recap' },
  { uia: 'player-skip-credits', kind: 'skip-credits' },
  { uia: 'next-episode-seamless-button', kind: 'next-episode' },
  { uia: 'next-episode-btn', kind: 'postplay-next' },
  { uia: 'postplay-preview-action', kind: 'postplay' },
  { uia: 'watch-credits-seamless-button', kind: 'watch-credits' },
  { uia: 'control-next', kind: 'control-next' }
] as const;

const tokens = new WeakMap<HTMLElement, string>();
let tokenSerial = 0;

export type NetflixServiceAction = {
  id: string;
  label: string;
};

export type NetflixServiceActionSource = {
  read(): NetflixServiceAction | null;
  activate(id: string): boolean;
};

export type NetflixServiceActionHooks = {
  enabled?: () => boolean;
  host?: () => boolean;
  href?: () => string;
  document?: Document;
};

export function createNetflixServiceActions(hooks: NetflixServiceActionHooks = {}): NetflixServiceActionSource {
  const enabled = hooks.enabled ?? (() => mediaProviderIntegrationEnabled('netflix'));
  const host = hooks.host ?? (() => isNetflixHost());
  const href = hooks.href ?? (() => window.location.href);
  const doc = hooks.document ?? document;

  const live = (): { id: string; label: string; element?: HTMLElement } | null => {
    if (!allowed(enabled, host)) return null;
    const root = watchPlayer(doc);
    if (!root) return null;
    const path = watchPath(href());
    const videoId = netflixVideoId(root.getAttribute('data-videoid'));
    if (!videoId || path !== `/watch/${videoId}`) return null;
    // Prefer the native-clock action so its identity survives chrome unmounts.
    const timed = readNetflixTimedAction(doc, videoId);
    if (timed) return timed;
    for (const action of NETFLIX_ACTIONS) {
      const element = findUsable(root, action.uia);
      if (!element) continue;
      const label = nativeLabel(element);
      if (!label) continue;
      return {
        id: actionId(action.kind, root, href(), element),
        label,
        element
      };
    }
    return null;
  };

  return {
    read() {
      const action = live();
      return action ? { id: action.id, label: action.label } : null;
    },
    activate(id: string): boolean {
      const action = live();
      if (!action || action.id !== id) return false;
      if (!action.element) return requestNetflixTimedAction(id);
      if (!usable(action.element)) return false;
      action.element.click();
      return true;
    }
  };
}

function allowed(enabled: () => boolean, host: () => boolean): boolean {
  try {
    return enabled() === true && host() === true;
  } catch {
    return false;
  }
}

function watchPlayer(doc: Document): HTMLElement | null {
  const root = doc.querySelector('.watch-video [data-uia="player"]');
  return root instanceof HTMLElement ? root : null;
}

function findUsable(root: ParentNode, uia: string): HTMLElement | null {
  const node = root.querySelector(`button[data-uia="${uia}"], a[data-uia="${uia}"]`);
  if (!(node instanceof HTMLElement) || !usable(node)) return null;
  return node;
}

function usable(element: HTMLElement): boolean {
  return element.isConnected && !disabled(element) && displayed(element);
}

function disabled(element: HTMLElement): boolean {
  if (element.getAttribute('aria-disabled') === 'true') return true;
  try {
    return element.matches(':disabled');
  } catch {
    return true;
  }
}

/** display:none and the hidden attribute. visibility:hidden stays usable. */
function displayed(element: HTMLElement): boolean {
  let node: HTMLElement | null = element;
  while (node) {
    if (node.hidden) return false;
    try {
      if (getComputedStyle(node).display === 'none') return false;
    } catch {
      return false;
    }
    node = node.parentElement;
  }
  return true;
}

function nativeLabel(element: HTMLElement): string {
  const text = (element.textContent || '').replace(/\s+/g, ' ').trim();
  const aria = (element.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
  return (text || aria).slice(0, 80);
}

function actionId(kind: string, root: HTMLElement, href: string, element: HTMLElement): string {
  const videoId = netflixVideoId(root.getAttribute('data-videoid')) ?? '';
  return `${kind}|${videoId}|${watchPath(href)}|${elementToken(element)}`;
}

function watchPath(href: string): string {
  try {
    const id = netflixWatchId(new URL(href, 'https://www.netflix.com').pathname);
    return id ? `/watch/${id}` : '';
  } catch {
    return '';
  }
}

function elementToken(element: HTMLElement): string {
  let token = tokens.get(element);
  if (!token) {
    tokenSerial += 1;
    token = `e${tokenSerial}`;
    tokens.set(element, token);
  }
  return token;
}
