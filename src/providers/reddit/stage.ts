import type { ProviderStage } from '../../core/provider-presentation';

import { redditCaptionOverlay, redditPlayerOf } from './player';

type Hidden = { overlay: HTMLElement; display: string; priority: string };
let hidden: Hidden | null = null;

function restore(): void {
  if (!hidden) return;
  const { overlay, display, priority } = hidden;
  hidden = null;
  if (display) overlay.style.setProperty('display', display, priority);
  else overlay.style.removeProperty('display');
}

function hide(element: HTMLElement): void {
  restore();
  const player = redditPlayerOf(element);
  const overlay = player ? redditCaptionOverlay(player) : null;
  if (!overlay) return;
  hidden = { overlay, display: overlay.style.getPropertyValue('display'), priority: overlay.style.getPropertyPriority('display') };
  overlay.style.setProperty('display', 'none', 'important');
}

/**
 * Reddit keeps drawing its captions in the inline player's box, under the pinned theater video, where nobody can see
 * them; the theater's own caption overlay takes over from Reddit's setting instead (see the adapter). The overlay is
 * hidden while the theater holds its player and handed back unchanged on exit or when theater moves to another
 * player. Reddit's caption setting itself is never touched.
 */
export const redditTheaterStage: ProviderStage = {
  mount(_hostname, element) {
    hide(element);
  },
  // Runs on the theater's layout checks: only a replaced overlay needs another lookup.
  ensure(_hostname, element) {
    if (!hidden?.overlay.isConnected) hide(element);
  },
  unmount: restore
};
