import type { ContentAuthor } from '../media-features/content-title';
import type { bindMenuPopover } from '../ui/menu-popover';

import type { DisposableScope } from './disposable-scope';

/**
 * What the player lends a provider for the title plate's author byline. The view that uses it ships with the providers
 * (like the playlist panel), so its markup, styles and strings stay out of the shared bundle.
 */
export interface AuthorBylineHost {
  /** The controls' scope: the panel, its cards and their listeners and timers end with it. */
  scope: DisposableScope;
  bindMenu: typeof bindMenuPopover;
}

/** The author panel at the start of the title plate, and one card per author. */
export interface AuthorBylineControl {
  /**
   * Called with every title publication: shows `authors` at the start of `plate` (the title HUD), or takes the panel
   * out for none. The authors were published with that title, so they are never older than it; a cleared title (no
   * plate) clears them, so a later settings change cannot bring back the previous item's authors. The panel is content
   * the plate hosts, not its title: the plate's hover rules (shadow.css) skip it, and it clears the plate's tooltip.
   * While the first author's avatar gives it a color, the view also gives it to the home button in the plate's header
   * row (its accent and `--home-ink`, shadow.css), and takes it back when it has none or ends.
   */
  render(authors: readonly ContentAuthor[] | null | undefined, plate: HTMLElement | null): void;
}
