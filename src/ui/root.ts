import { observeAppearance } from '../appearance-runtime';
import { ensureNewBadgeStyles } from './new-badge';
import { applyUiDirection } from './messages';

// Both script worlds must leave native button activation to the focused UI control.
export const PLAYER_NATIVE_ACTIVATION_SELECTOR = '.theater-menu, .theater-service-action-host, '
  + '.theater-time-end, .theater-controls-row button, .te-dialog-overlay';

const HOST_ID = 'theater-everywhere-ui';
const STYLE_ID = 'theater-everywhere-ui-styles';

let hostEl: HTMLElement | null = null;
let shadow: ShadowRoot | null = null;
let playerUiCss = '';
let stopAppearance: (() => void) | undefined;

export function setPlayerUiCss(css: string): void {
  playerUiCss = css;
  if (shadow && hostEl?.isConnected) ensureShadowStyles(shadow);
}

function ensureShadowStyles(root: ShadowRoot): void {
  if (!playerUiCss) return;
  const existing = root.getElementById(STYLE_ID);
  if (existing) {
    if (existing.textContent !== playerUiCss) existing.textContent = playerUiCss;
    return;
  }

  // Inline the skin before chrome is mounted. A <link rel="stylesheet"> would
  // paint the shadow tree as raw HTML until the sheet loads.
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = playerUiCss;
  root.appendChild(style);
}

export function getPlayerUiRoot(): ShadowRoot {
  if (shadow && hostEl?.isConnected) return shadow;

  stopAppearance?.();
  hostEl = document.getElementById(HOST_ID);
  if (!hostEl) {
    hostEl = document.createElement('div');
    hostEl.id = HOST_ID;
    hostEl.setAttribute('data-theater-everywhere-ui', '');
    applyUiDirection(hostEl);
    (document.documentElement || document.body).appendChild(hostEl);
  }
  stopAppearance = observeAppearance(hostEl);
  shadow = hostEl.shadowRoot || hostEl.attachShadow({ mode: 'open' });
  ensureShadowStyles(shadow);
  ensureNewBadgeStyles(shadow);
  if (!shadow.getElementById('theater-announcements')) {
    const status = document.createElement('div');
    status.id = 'theater-announcements';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-atomic', 'true');
    // Keep the live region mounted before feedback arrives, without taking layout space.
    status.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;';
    shadow.appendChild(status);
  }
  return shadow;
}

export function peekPlayerUiRoot(): ShadowRoot | null {
  if (shadow && hostEl?.isConnected) return shadow;
  const host = document.getElementById(HOST_ID);
  return host?.shadowRoot || null;
}

export function mountPlayerUi(el: HTMLElement): HTMLElement {
  getPlayerUiRoot().appendChild(el);
  return el;
}

export function queryPlayerUi<T extends Element>(selector: string): T | null {
  return (peekPlayerUiRoot()?.querySelector(selector) || null) as T | null;
}

export function queryPlayerUiAll<T extends Element>(selector: string): T[] {
  const root = peekPlayerUiRoot();
  return root ? Array.from(root.querySelectorAll<T>(selector)) : [];
}

export function destroyPlayerUi(): void {
  cancelPendingAnnouncement();
  stopAppearance?.();
  stopAppearance = undefined;
  hostEl?.remove();
  hostEl = null;
  shadow = null;
}

export function eventPathIncludes(event: Event, node: Node | null): boolean {
  if (!node) return false;
  return event.composedPath().includes(node);
}

export function eventPathMatches(event: Event, selector: string): boolean {
  return event.composedPath().some((entry) => entry instanceof Element && entry.matches(selector));
}

let pendingAnnouncement: number | undefined;

function cancelPendingAnnouncement(): void {
  if (pendingAnnouncement === undefined) return;
  clearTimeout(pendingAnnouncement);
  pendingAnnouncement = undefined;
}

/**
 * User feedback only; playback ticks never write to the live region. The region is
 * cleared first and the latest text restored in a later task, because a screen reader
 * may ignore a repeated identical message (two quick seeks) as "no change".
 */
export function announcePlayerStatus(message: string): void {
  const status = peekPlayerUiRoot()?.getElementById('theater-announcements');
  if (!status) return;
  cancelPendingAnnouncement();
  status.replaceChildren();
  pendingAnnouncement = window.setTimeout(() => {
    pendingAnnouncement = undefined;
    status.replaceChildren(document.createTextNode(message));
  }, 50);
}
