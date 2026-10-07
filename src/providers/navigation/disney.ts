import type { PlaylistAction } from '../../playlist-nav';
import { mediaProviderIntegrationEnabled } from '../../media-features/provider-flags';
import { isDisneyHost } from '../hosts';

const PLAY_ID = /\/play\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
const CONTROL_ROOTS = [
  'main-app-controls-overlay',
  'controls-overlay',
  'vibe-full-bleed-controls-overlay',
  'disney-web-player-ui',
  'disney-web-player'
];

/**
 * Disney's control-bar next episode. It sits with play and pause, and the
 * host sets `hidden` unless a sequential episode can start. Theater chrome
 * may hide that bar with display, visibility, or opacity; the step follows
 * the host's own hidden and disabled state. End-of-title countdown and the
 * end card stay on the player-surface CTA.
 */
export function findDisneyPlaylistActions(root: ParentNode, href: () => string): PlaylistAction[] {
  if (!disneyNavEnabled()) return [];
  const doc = pageDocument(root);
  const playId = disneyPlayId(href());
  if (!doc || !playId) return [];
  const button = findPlayNext(doc);
  if (!button) return [];
  return [{
    direction: 'next',
    preview: null,
    restarts: false,
    activate() {
      if (!disneyNavEnabled() || disneyPlayId(href()) !== playId) return;
      const live = findPlayNext(doc);
      if (!live) return;
      live.click();
    }
  }];
}

function disneyNavEnabled(): boolean {
  try {
    return isDisneyHost() === true && mediaProviderIntegrationEnabled('disney') === true;
  } catch {
    return false;
  }
}

function findPlayNext(doc: Document): HTMLButtonElement | null {
  for (const host of playNextHosts(doc)) {
    if (!host.isConnected || host.hidden) continue;
    const button = host.shadowRoot?.querySelector('button.play-next');
    if (button instanceof HTMLButtonElement && actionable(button)) return button;
  }
  return null;
}

function playNextHosts(doc: Document): HTMLElement[] {
  const found: HTMLElement[] = [];
  const visit = (node: ParentNode, depth: number) => {
    if (depth > 8) return;
    for (const el of node.querySelectorAll('*')) {
      if (el.tagName === 'PLAY-NEXT' && el instanceof HTMLElement) found.push(el);
      if (el.shadowRoot) visit(el.shadowRoot, depth + 1);
    }
  };
  for (const selector of CONTROL_ROOTS) {
    const root = doc.querySelector(selector);
    if (!root) continue;
    visit(root, 0);
    if (root instanceof HTMLElement && root.shadowRoot) visit(root.shadowRoot, 1);
  }
  return found;
}

function actionable(button: HTMLButtonElement): boolean {
  return button.isConnected && !button.hidden && !button.disabled && button.getAttribute('aria-disabled') !== 'true';
}

function disneyPlayId(href: string): string | null {
  try {
    const match = new URL(href, 'https://www.disneyplus.com').pathname.match(PLAY_ID);
    return match ? match[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

function pageDocument(root: ParentNode): Document | null {
  if ((root as Node).nodeType === 9) return root as Document;
  return (root as Node).ownerDocument || null;
}
