import type { DisposableScope } from '../core/disposable-scope';
import type { PlaylistPanelSource } from '../core/playlist-panel';

import type { ButtonTooltipBinder } from './button-tooltip';
import { strokeIcon } from './hud';
import { bindMenuPopover, MENU_CLOSE_EVENT, MENU_OPEN_EVENT } from './menu-popover';
import { setSvgIcon } from './svg-icon';

const PLAYLIST_ICON = strokeIcon('<path d="M3 6h13M3 12h9M3 18h7"/><path d="M15 14.5v6l5.5-3z" fill="currentColor"/>', 18);

/**
 * The bar's playlist toggle and its panel, in the shared list-menu shell (the subtitle menu's), so hover, pinning,
 * Escape, outside presses, focus, `aria-expanded` and the bar's visibility behave as in the other menus. The provider
 * fills the panel for each opening, and that opening's scope ends when the panel closes: nothing reads or observes
 * the host while it is shut.
 */
export function mountPlaylistPanel(options: {
  source: PlaylistPanelSource;
  scope: DisposableScope;
  label: string;
  bindTooltip: ButtonTooltipBinder;
  /** Closes the bar's other menus before this one opens. */
  onBeforeOpen?: () => void;
  /** The panel opened or closed. */
  onChange?: () => void;
}): { host: HTMLElement; syncAvailability: () => void; close: (restoreFocus?: boolean) => boolean } {
  const { source, scope } = options;
  const host = document.createElement('div');
  host.className = 'theater-menu-anchored';
  host.hidden = true;
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'theater-control-btn theater-playlist-toggle';
  trigger.setAttribute('aria-label', options.label);
  setSvgIcon(trigger, PLAYLIST_ICON);
  options.bindTooltip(trigger, () => options.label);
  const panel = document.createElement('div');
  panel.className = 'theater-cc-menu theater-playlist-menu';
  host.append(trigger, panel);

  let opening: DisposableScope | null = null;
  const unmount = () => {
    opening?.dispose();
    opening = null;
  };
  const menu = bindMenuPopover({
    host, trigger, panel, scope,
    onBeforeOpen: options.onBeforeOpen,
    // Keyboard opening lands on the playing item (the list's active row), and the list opens centred on it.
    firstFocus: () => panel.querySelector<HTMLElement>('.active') ?? undefined,
    centerActiveIn: '.theater-cc-menu-list',
    onChange: options.onChange
  });
  // The opening is a child of `scope`, so tearing the controls down ends it too.
  // Dispatched before the menu positions itself, so the provider's rows are in place for focus and centring.
  scope.listen(panel, MENU_OPEN_EVENT, () => {
    unmount();
    opening = scope.child();
    source.mount(panel, opening, menu.close);
  });
  scope.listen(panel, MENU_CLOSE_EVENT, unmount);

  return {
    host,
    close: menu.close,
    syncAvailability() {
      const available = source.available();
      if (!available) menu.close();
      if (host.hidden === available) host.hidden = !available;
    }
  };
}
