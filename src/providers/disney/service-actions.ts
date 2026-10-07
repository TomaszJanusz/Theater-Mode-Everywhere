import type { ServiceAction, ServiceActionSource } from '../../core/service-actions';
import { mediaProviderIntegrationEnabled } from '../../media-features/provider-flags';
import { isDisneyHost } from '../hosts';

const PLAY_ID = /\/play\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

const tokens = new WeakMap<HTMLElement, string>();
let tokenSerial = 0;

export type DisneyServiceActionHooks = {
  enabled?: () => boolean;
  host?: () => boolean;
  href?: () => string;
  document?: Document;
};

type LiveAction = ServiceAction & { element: HTMLElement };

/**
 * Disney draws skip and up-next inside open shadow roots and removes the
 * skip button when its window closes. Controls may decay around a still-live
 * skip; display:none and the hidden attribute are the rejection signals.
 * Skip intro, recap, and credits share one button whose label is the kind.
 * The inner button dispatches a composed `activate` event, so a click is enough.
 * The control-bar next episode stays on the player bar. These actions are only
 * the end-of-title surfaces Disney draws over the video.
 */
export function createDisneyServiceActions(hooks: DisneyServiceActionHooks = {}): ServiceActionSource {
  const enabled = hooks.enabled ?? (() => mediaProviderIntegrationEnabled('disney'));
  const host = hooks.host ?? (() => isDisneyHost());
  const href = hooks.href ?? (() => window.location.href);
  const doc = hooks.document ?? document;

  const live = (): LiveAction[] => {
    if (!allowed(enabled, host)) return [];
    const playId = disneyPlayId(href());
    const player = doc.querySelector('disney-web-player');
    if (!playId || !(player instanceof HTMLElement) || !player.isConnected) return [];
    const found: LiveAction[] = [];
    const skip = skipButton(doc);
    const skipLabel = skip ? controlLabel(skip) : '';
    if (skip && skipLabel && usable(skip)) {
      found.push({ id: `disney:skip|${playId}|${skipLabel}|${elementToken(skip)}`, label: skipLabel, element: skip });
    }
    const next = upNextButton(doc);
    const nextLabel = next ? controlLabel(next) : '';
    const nextLive = Boolean(next && nextLabel && usable(next));
    if (next && nextLive) {
      found.push({ id: `disney:next|${playId}|${elementToken(next)}`, label: nextLabel, element: next });
    }
    const end = endCard(doc);
    if (end && !nextLive) {
      const tile = end.root.querySelector('button.end-card-overlay__content-tile');
      const tileLabel = endLabel(end.root);
      if (tile instanceof HTMLElement && tileLabel && usable(tile)) {
        const progress = ringProgress(end.root);
        found.push({
          id: `disney:end|${playId}|${elementToken(tile)}`,
          label: tileLabel,
          element: tile,
          ...(progress === undefined ? {} : { progress })
        });
      }
    }
    if (end) {
      const close = end.root.querySelector('button.end-card-header__close-container');
      const closeLabel = close instanceof HTMLElement ? controlLabel(close) : '';
      if (close instanceof HTMLElement && closeLabel && usable(close)) {
        found.push({ id: `disney:close|${playId}|${elementToken(close)}`, label: closeLabel, element: close });
      }
    }
    return found;
  };

  return {
    read: () => live().map(({ element: _element, ...action }) => action),
    activate(id: string): boolean {
      const action = live().find(action => action.id === id);
      if (!action || !usable(action.element)) return false;
      action.element.click();
      return true;
    }
  };
}

function endCard(doc: Document): { root: ShadowRoot } | null {
  const host = doc.querySelector('end-card-overlay');
  if (!(host instanceof HTMLElement) || !host.isConnected || host.hidden || !host.shadowRoot) return null;
  return { root: host.shadowRoot };
}

function endLabel(root: ParentNode): string {
  const countdown = root.querySelector('.end-card-header__countdown-text');
  return controlLabel(countdown instanceof HTMLElement ? countdown : null);
}

function skipButton(doc: Document): HTMLElement | null {
  const overlay = doc.querySelector('skip-overlay');
  const host = overlay?.shadowRoot?.querySelector('skip-button');
  const button = host?.shadowRoot?.querySelector('button');
  return button instanceof HTMLElement ? button : null;
}

function upNextButton(doc: Document): HTMLElement | null {
  const host = doc.querySelector('up-next-lite-v1');
  if (!(host instanceof HTMLElement) || host.hidden) return null;
  const button = host.shadowRoot?.querySelector('button.up-next-lite-v1-overlay__button');
  return button instanceof HTMLElement ? button : null;
}

function ringProgress(root: ParentNode): number | undefined {
  const circle = root.querySelector<HTMLElement>('.progress-ring__circle');
  if (!circle) return undefined;
  const animation = circle.getAnimations().find(item =>
    item instanceof CSSAnimation || item instanceof CSSTransition);
  const progress = animation?.effect?.getComputedTiming().progress;
  if (typeof progress !== 'number' || !Number.isFinite(progress)) return undefined;
  return Math.max(0, Math.min(1, progress));
}

function disneyPlayId(href: string): string | null {
  try {
    const match = new URL(href, 'https://www.disneyplus.com').pathname.match(PLAY_ID);
    return match ? match[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

function allowed(enabled: () => boolean, host: () => boolean): boolean {
  try {
    return enabled() === true && host() === true;
  } catch {
    return false;
  }
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

/** Crosses open shadow roots. visibility and opacity stay usable. */
function displayed(element: HTMLElement): boolean {
  let node: HTMLElement | null = element;
  const seen = new Set<HTMLElement>();
  while (node && !seen.has(node)) {
    seen.add(node);
    if (node.hidden) return false;
    try {
      if (getComputedStyle(node).display === 'none') return false;
    } catch {
      return false;
    }
    const root = node.getRootNode();
    node = node.parentElement || (root instanceof ShadowRoot && root.host instanceof HTMLElement ? root.host : null);
  }
  return true;
}

function controlLabel(element: HTMLElement | null): string {
  if (!element) return '';
  const text = (element.textContent || '').replace(/\s+/g, ' ').trim();
  const aria = (element.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
  return (text || aria).slice(0, 80);
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
