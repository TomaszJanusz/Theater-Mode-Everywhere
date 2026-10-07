import { mediaProviderIntegrationEnabled } from '../../media-features/provider-flags';
import { isDisneyHost } from '../hosts';

export const DISNEY_PLAY_NEXT_EVENT = 'theater-everywhere-disney-play-next';
export const DISNEY_PLAY_NEXT_ACK_EVENT = 'theater-everywhere-disney-play-next-ack';
export const DISNEY_PLAY_NEXT_ATTR = 'data-te-disney-play-next';

const PLAY_ID = /\/play\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
const CONTROL_ROOTS = [
  'main-app-controls-overlay',
  'controls-overlay',
  'vibe-full-bleed-controls-overlay',
  'disney-web-player-ui',
  'disney-web-player'
];

type PlayNextHost = HTMLElement & { primaryAction?: () => void };

let installed = false;
let remembered: { playId: string; host: PlayNextHost } | null = null;

/**
 * Disney mounts the bar's next episode only while its own controls are up,
 * and a desktop player also keeps a display:none copy for the narrow layout.
 * Remember the wide control and invoke its action after the bar unmounts.
 */
export function installDisneyPlayNext(): void {
  if (typeof window === 'undefined') return;
  if (!installed) {
    installed = true;
    window.addEventListener(DISNEY_PLAY_NEXT_EVENT, onDisneyPlayNextRequest);
    window.setInterval(syncDisneyPlayNext, 500);
  }
  syncDisneyPlayNext();
}

export function requestDisneyPlayNext(playId: string): boolean {
  if (!playId) return false;
  let ok = false;
  const ack = (event: Event) => {
    if ((event as CustomEvent<unknown>).detail === `ok:${playId}`) ok = true;
  };
  window.addEventListener(DISNEY_PLAY_NEXT_ACK_EVENT, ack);
  try {
    window.dispatchEvent(new CustomEvent(DISNEY_PLAY_NEXT_EVENT, { detail: playId }));
  } finally {
    window.removeEventListener(DISNEY_PLAY_NEXT_ACK_EVENT, ack);
  }
  return ok;
}

export function disneyPlayNextPublished(doc: Document, playId: string): boolean {
  return doc.documentElement.getAttribute(DISNEY_PLAY_NEXT_ATTR)?.toLowerCase() === playId;
}

export function findDisneyPlayNextButton(doc: Document): HTMLButtonElement | null {
  const host = findDisneyPlayNextHost(doc);
  return host ? livePlayNextButton(host) : null;
}

function onDisneyPlayNextRequest(event: Event): void {
  const playId = typeof (event as CustomEvent<unknown>).detail === 'string'
    ? (event as CustomEvent<string>).detail.toLowerCase()
    : '';
  const host = remembered?.playId === playId ? remembered.host : null;
  let ok = false;
  if (host && playId && playId === currentPlayId() && disneyPlayNextEnabled()) {
    const usable = !host.isConnected || livePlayNextButton(host) !== null;
    try {
      if (usable && typeof host.primaryAction === 'function') {
        host.primaryAction();
        ok = true;
      }
    } catch {
      ok = false;
    }
  }
  window.dispatchEvent(new CustomEvent(DISNEY_PLAY_NEXT_ACK_EVENT, { detail: `${ok ? 'ok' : 'no'}:${playId}` }));
}

function syncDisneyPlayNext(): void {
  const doc = document;
  const playId = currentPlayId();
  if (!disneyPlayNextEnabled() || !playId) {
    remembered = null;
    doc.documentElement.removeAttribute(DISNEY_PLAY_NEXT_ATTR);
    return;
  }
  const hosts = playNextHosts(doc);
  const available = offeredPlayNextHosts(hosts);
  if (available.length) {
    remembered = { playId, host: preferLaidOut(available) };
    doc.documentElement.setAttribute(DISNEY_PLAY_NEXT_ATTR, playId);
    return;
  }
  // The narrow copy stays mounted with display:none after the wide bar leaves.
  if (hosts.some((host) => !collapsedLayout(host)) || remembered?.playId !== playId) {
    remembered = null;
    doc.documentElement.removeAttribute(DISNEY_PLAY_NEXT_ATTR);
    return;
  }
  doc.documentElement.setAttribute(DISNEY_PLAY_NEXT_ATTR, playId);
}

function findDisneyPlayNextHost(doc: Document): PlayNextHost | null {
  const available = offeredPlayNextHosts(playNextHosts(doc));
  return available.length ? preferLaidOut(available) : null;
}

function offeredPlayNextHosts(hosts: PlayNextHost[]): PlayNextHost[] {
  return hosts.filter((host) => host.isConnected && !host.hidden && !collapsedLayout(host) && livePlayNextButton(host));
}

function livePlayNextButton(host: PlayNextHost): HTMLButtonElement | null {
  const button = host.shadowRoot?.querySelector('button.play-next');
  if (!(button instanceof HTMLButtonElement)) return null;
  if (!button.isConnected || button.hidden || button.disabled || button.getAttribute('aria-disabled') === 'true') return null;
  return button;
}

function preferLaidOut(hosts: PlayNextHost[]): PlayNextHost {
  return hosts.find((host) => !collapsedLayout(host)) || hosts[0];
}

function collapsedLayout(host: HTMLElement): boolean {
  const wrapper = host.closest('.experience-controls-narrow, .experience-controls');
  if (!(wrapper instanceof HTMLElement)) return false;
  try {
    return getComputedStyle(wrapper).display === 'none';
  } catch {
    return false;
  }
}

function playNextHosts(doc: Document): PlayNextHost[] {
  const found: PlayNextHost[] = [];
  const visit = (node: ParentNode, depth: number) => {
    if (depth > 8) return;
    for (const el of node.querySelectorAll('*')) {
      if (el.tagName === 'PLAY-NEXT' && el instanceof HTMLElement) found.push(el);
      if (el.shadowRoot) visit(el.shadowRoot, depth + 1);
    }
  };
  for (const selector of CONTROL_ROOTS) {
    for (const root of doc.querySelectorAll(selector)) {
      visit(root, 0);
      if (root instanceof HTMLElement && root.shadowRoot) visit(root.shadowRoot, 1);
    }
  }
  return found;
}

function disneyPlayNextEnabled(): boolean {
  try {
    return isDisneyHost() === true && mediaProviderIntegrationEnabled('disney') === true;
  } catch {
    return false;
  }
}

function currentPlayId(): string | null {
  try {
    const match = new URL(window.location.href).pathname.match(PLAY_ID);
    return match ? match[1].toLowerCase() : null;
  } catch {
    return null;
  }
}
