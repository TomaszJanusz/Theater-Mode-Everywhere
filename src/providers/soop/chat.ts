import type { ProviderChat } from '../provider-api';

import { soopRoute } from './dom';
import { SOOP_NAVIGATE_EVENT } from './history';

/** The player marks `#webplayer` with `chat_open` while its chat panel is shown. */
export function readSoopChatVisibility(root: HTMLElement): boolean | null {
  const player = root.ownerDocument.getElementById('webplayer');
  return player ? player.classList.contains('chat_open') : null;
}

const ROOT = '#webplayer #chatting_area';
const TOGGLE = '#webplayer li.btn_chat button';

export const soopChat: ProviderChat = {
  matchesHost: hostname => hostname === 'play.sooplive.com' || hostname === 'vod.sooplive.com',
  parseLocation(url) {
    const route = soopRoute(url);
    if (!route) return null;
    return route.kind === 'live'
      ? { role: 'watch', provider: 'soop', contentKey: `${route.bj}/${route.id}`, kind: 'live' }
      : { role: 'watch', provider: 'soop', contentKey: route.id, kind: 'replay' };
  },
  detect(document, href) {
    const page = soopChat.parseLocation(new URL(href));
    const root = document.querySelector(ROOT);
    const section = root?.querySelector('.chatbox');
    if (!page || page.role !== 'watch' || !page.kind || !(root instanceof HTMLElement) || !(section instanceof HTMLElement)) return null;
    const ancestors: HTMLElement[] = [];
    for (let node = root.parentElement; node && node !== document.body && node !== document.documentElement; node = node.parentElement) ancestors.push(node);
    return { provider: 'soop', contentKey: page.contentKey, kind: page.kind, root, contentRoot: section,
      revealAncestors: ancestors, initiallyVisible: readSoopChatVisibility(root) };
  },
  activation(document, href) {
    const page = soopChat.parseLocation(new URL(href));
    if (!page || page.role !== 'watch') return null;
    const control = document.querySelector(TOGGLE);
    const player = document.getElementById('webplayer');
    return control instanceof HTMLElement && !control.matches('[disabled], [aria-disabled="true"]') && player && !player.classList.contains('chat_open')
      ? { provider: 'soop', contentKey: page.contentKey, control } : null;
  },
  eventSelector: `${ROOT}, .chatbox, #emoticonContainer, .chat_layer`,
  activationSelector: TOGGLE,
  shellSelector: ROOT,
  navigationEvents: [SOOP_NAVIGATE_EVENT],
  observeVisibility(surface, changed) {
    // The panel's own close button and the player's chat button only flip `chat_open` (and an inline
    // display), so one attribute observer on the player is enough; other class flips are ignored.
    const player = surface.root.closest('#webplayer');
    if (!player) return () => {};
    let open = player.classList.contains('chat_open');
    const observer = new MutationObserver(() => {
      if (player.classList.contains('chat_open') === open) return;
      open = !open;
      changed();
    });
    observer.observe(player, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }
};
