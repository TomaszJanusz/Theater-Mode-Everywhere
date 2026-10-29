import type { ServiceAction, ServiceActionSource } from '../../core/service-actions';
import { mediaProviderIntegrationEnabled } from '../../media-features/provider-flags';

import { isVikiHost } from './hosts';
import { vikiVideoId } from './playback-data';

const SKIP_INTRO = '[data-what="skip_intro_button"]';
const NEXT_EPISODE = '[data-what="next_episode_button"]';

const tokens = new WeakMap<HTMLElement, string>();
let tokenSerial = 0;

export type VikiServiceActionHooks = {
  enabled?: () => boolean;
  host?: () => boolean;
  href?: () => string;
  document?: Document;
};

type LiveAction = ServiceAction & { element: HTMLElement };

/**
 * Viki mounts its skip-intro and next-episode pills in the player and shows them by dropping
 * `vjs-hidden` (from the pill or its wrapper) while the host's own rules say so, so the host owns
 * when each is available. An action is live only for the episode in the URL and only while its
 * pill is shown and enabled; activation revalidates that and clicks the pill itself.
 */
export function createVikiServiceActions(hooks: VikiServiceActionHooks = {}): ServiceActionSource {
  const enabled = hooks.enabled ?? (() => mediaProviderIntegrationEnabled('viki'));
  const host = hooks.host ?? (() => isVikiHost());
  const href = hooks.href ?? (() => window.location.href);
  const doc = hooks.document ?? document;

  const live = (): LiveAction[] => {
    try {
      if (enabled() !== true || host() !== true) return [];
    } catch {
      return [];
    }
    const videoId = vikiVideoId(new URL(href(), 'https://www.viki.com'));
    const player = doc.querySelector('#vmplayer_id.video-js');
    if (!videoId || !player?.isConnected) return [];
    const found: LiveAction[] = [];
    for (const [kind, selector] of [['skip', SKIP_INTRO], ['next', NEXT_EPISODE]] as const) {
      const pill = player.querySelector<HTMLElement>(selector);
      const label = pill ? (pill.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80) : '';
      if (pill && label && shown(pill)) found.push({ id: `viki:${kind}|${videoId}|${token(pill)}`, label, element: pill });
    }
    return found;
  };

  return {
    read: () => live().map(({ element: _element, ...action }) => action),
    activate(id: string): boolean {
      const action = live().find(item => item.id === id);
      if (!action) return false;
      action.element.click();
      return true;
    }
  };
}

function shown(pill: HTMLElement): boolean {
  if (pill.getAttribute('aria-disabled') === 'true' || pill.matches(':disabled')) return false;
  for (let node: HTMLElement | null = pill; node && !node.matches('#vmplayer_id'); node = node.parentElement) {
    if (node.hidden || node.classList.contains('vjs-hidden')) return false;
    try {
      if (getComputedStyle(node).display === 'none') return false;
    } catch {
      return false;
    }
  }
  return true;
}

function token(element: HTMLElement): string {
  let value = tokens.get(element);
  if (!value) {
    tokenSerial += 1;
    value = `e${tokenSerial}`;
    tokens.set(element, value);
  }
  return value;
}
