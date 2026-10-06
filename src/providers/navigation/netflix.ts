import type { PlaylistAction } from '../../playlist-nav';
import { mediaProviderIntegrationEnabled } from '../../media-features/provider-flags';
import { netflixVideoId } from '../../media-features/parsers/netflix-page';
import { isNetflixHost } from '../hosts';
import { netflixWatchId } from '../netflix/session';

const NEXT_BUTTON = 'button[data-uia="control-next"]';

/**
 * Native watch-toolbar Next. Stage CSS hides chrome with visibility, opacity,
 * and pointer-events, so those stay actionable. display:none, a disabled
 * control, and a disconnected node do not. Previous stays absent: the toolbar
 * exposes control-next, not a previous-episode control. The click rechecks the
 * same button against the current /watch id so a replacement or a new title
 * cannot run a stale action. The integration flag turns the step off.
 */
export function findNetflixPlaylistActions(
  root: ParentNode,
  video: HTMLVideoElement | null | undefined,
  href: () => string
): PlaylistAction[] {
  if (!netflixNavEnabled()) return [];
  const player = currentPlayer(root, video, href());
  if (!player) return [];
  const videoId = boundVideoId(player, href());
  if (!videoId) return [];
  const button = findNextButton(player);
  if (!button) return [];
  return [{
    direction: 'next',
    preview: null,
    restarts: false,
    activate() {
      if (!netflixNavEnabled()) return;
      if (!within(root, player)) return;
      if (video && video.closest('.watch-video [data-uia="player"]') !== player) return;
      if (boundVideoId(player, href()) !== videoId) return;
      if (!player.contains(button) || !usable(button)) return;
      button.click();
    }
  }];
}

function netflixNavEnabled(): boolean {
  try {
    return isNetflixHost() === true && mediaProviderIntegrationEnabled('netflix') === true;
  } catch {
    return false;
  }
}

function currentPlayer(root: ParentNode, video: HTMLVideoElement | null | undefined, href: string): HTMLElement | null {
  if (video) {
    const player = video.closest('.watch-video [data-uia="player"]');
    if (!(player instanceof HTMLElement) || !within(root, player)) return null;
    return boundVideoId(player, href) ? player : null;
  }
  for (const player of playersIn(root)) {
    if (boundVideoId(player, href)) return player;
  }
  return null;
}

function playersIn(root: ParentNode): HTMLElement[] {
  const found: HTMLElement[] = [];
  if (root instanceof HTMLElement && root.matches('[data-uia="player"]') && root.closest('.watch-video')) {
    found.push(root);
  }
  if (root instanceof Document || root instanceof DocumentFragment || root instanceof Element || root instanceof ShadowRoot) {
    root.querySelectorAll('.watch-video [data-uia="player"]').forEach((node) => {
      if (node instanceof HTMLElement && !found.includes(node)) found.push(node);
    });
  }
  return found;
}

function boundVideoId(player: HTMLElement, href: string): string | null {
  const videoId = netflixVideoId(player.getAttribute('data-videoid'));
  if (!videoId) return null;
  try {
    const watchId = netflixWatchId(new URL(href, 'https://www.netflix.com').pathname);
    return watchId === videoId ? videoId : null;
  } catch {
    return null;
  }
}

function findNextButton(player: ParentNode): HTMLButtonElement | null {
  for (const node of player.querySelectorAll(NEXT_BUTTON)) {
    if (node instanceof HTMLButtonElement && usable(node)) return node;
  }
  return null;
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

function within(root: ParentNode, node: Node): boolean {
  if (root === node) return true;
  return root instanceof Node && root.contains(node);
}
