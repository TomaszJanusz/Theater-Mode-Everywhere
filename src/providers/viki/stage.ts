import type { ProviderStage } from '../../core/provider-presentation';
import { isVikiHost } from '../hosts';

export const VIKI_THEATER_STAGE_CLASS = 'theater-everywhere-viki-stage';
/** The player's own tabindex, kept while theater has taken it away. */
const SAVED_TABINDEX = 'data-te-viki-tabindex';

/**
 * Viki focuses its player container (`tabindex="-1"`) from a timer shortly after the pointer
 * leaves it. In theater the pointer is on the extension's controls, so that focus left an open
 * player menu and closed it. While theater is on the container is not focusable, which turns
 * Viki's `focus()` into a no-op; its value comes back on exit.
 */
function releaseFocus(player: Element): void {
  if (player.hasAttribute(SAVED_TABINDEX) || !player.hasAttribute('tabindex')) return;
  player.setAttribute(SAVED_TABINDEX, player.getAttribute('tabindex') ?? '');
  player.removeAttribute('tabindex');
}

function restoreFocus(): void {
  for (const player of document.querySelectorAll(`[${SAVED_TABINDEX}]`)) {
    player.setAttribute('tabindex', player.getAttribute(SAVED_TABINDEX) ?? '-1');
    player.removeAttribute(SAVED_TABINDEX);
  }
}

/**
 * Marks the document while a Video.js player is pinned, so presentation.css can lift its captions,
 * and keeps the player from taking focus. Viki rebuilds the player per episode; the runtime mounts
 * again on that replacement.
 */
export const vikiTheaterStage: ProviderStage = {
  mount(hostname, element) {
    const player = isVikiHost(hostname) ? element.closest('.video-js') : null;
    if (!player) return;
    document.documentElement.classList.add(VIKI_THEATER_STAGE_CLASS);
    releaseFocus(player);
  },
  unmount() {
    document.documentElement.classList.remove(VIKI_THEATER_STAGE_CLASS);
    restoreFocus();
  }
};
