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
   * out for none. The authors were published with that title, so they are never older than it.
   */
  render(authors: readonly ContentAuthor[] | null | undefined, plate: HTMLElement): void;
}
