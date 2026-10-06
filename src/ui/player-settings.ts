import type { DisposableScope } from '../core/disposable-scope';
import type { PlayerChromeContext } from './runtime-context';
import { shortcutDisplayParts } from './shortcuts';

/** Close the settings panel, optionally returning keyboard focus to its trigger. */
export function closePlayerSettings(root: ParentNode, restoreFocus = false): boolean {
  const container = root.querySelector<HTMLElement>('.theater-settings-container');
  const panel = root.querySelector<HTMLElement>('.theater-settings-menu');
  if (!panel) return false;
  const hoverOpen = Boolean(container?.matches(':hover') && !container.classList.contains('is-suppressed'));
  if (!panel.classList.contains('visible') && !hoverOpen) return false;
  const trigger = root.querySelector<HTMLButtonElement>('.player-settings-btn');
  const active = (panel.getRootNode() as Document | ShadowRoot).activeElement;
  panel.classList.remove('visible');
  // Keep a hovered panel from popping straight back open after Escape, help, or an outside click.
  container?.classList.add('is-suppressed');
  trigger?.setAttribute('aria-expanded', 'false');
  if (restoreFocus) trigger?.focus();
  else if (active instanceof HTMLElement && panel.contains(active)) active.blur();
  return true;
}

export function createPlayerSettings(ctx: PlayerChromeContext, scope: DisposableScope) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'theater-control-btn player-settings-btn';
  button.setAttribute('aria-label', ctx.t('playerSettingsLabel'));
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', 'theater-player-settings');
  ctx.actions.setIcon(button, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 3-.5 3-2 1.2-2.8-1L1.2 10.5l2.3 2v2.3l-2.3 2 2.5 4.3 2.8-1 2 1.2.5 3h6l.5-3 2-1.2 2.8 1 2.5-4.3-2.3-2v-2.3l2.3-2-2.5-4.3-2.8 1-2-1.2L15 3Z" transform="translate(2 0) scale(.83)"/><circle cx="12" cy="12" r="3"/></svg>`);

  const panel = document.createElement('div');
  panel.id = 'theater-player-settings';
  panel.className = 'theater-settings-menu';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', ctx.t('playerSettingsLabel'));
  ctx.paintOverlay(panel);

  const container = document.createElement('div');
  container.className = 'theater-settings-container';
  container.append(button, panel);

  const syncExpanded = () => {
    const hoverOpen = container.matches(':hover') && !container.classList.contains('is-suppressed');
    button.setAttribute('aria-expanded', panel.classList.contains('visible') || hoverOpen ? 'true' : 'false');
  };
  const close = (restoreFocus = false) => {
    const closed = closePlayerSettings(panel.getRootNode() as ParentNode, restoreFocus);
    if (closed) ctx.actions.updateCaptionDock();
    return closed;
  };
  scope.listen(container, 'pointerenter', () => {
    container.classList.remove('is-suppressed');
    syncExpanded();
    ctx.actions.updateCaptionDock();
  });
  scope.listen(container, 'pointerleave', () => {
    window.requestAnimationFrame(() => {
      syncExpanded();
      ctx.actions.updateCaptionDock();
    });
  });
  button.addEventListener('click', (event) => {
    // A pointer click only reveals the menu while the pointer stays, the way volume and speed do.
    if (event.detail !== 0) {
      button.blur();
      return;
    }
    ctx.actions.closeTheaterPopovers();
    panel.classList.add('visible');
    button.setAttribute('aria-expanded', 'true');
    panel.querySelector<HTMLButtonElement>('button')?.focus();
    ctx.actions.showToolbar();
    ctx.actions.updateCaptionDock();
  });
  const closeOnFocusLeave = (event: FocusEvent) => {
    const next = (event as FocusEvent).relatedTarget;
    if (next instanceof Node && next !== button && !panel.contains(next)) close();
  };
  scope.listen(panel, 'focusout', closeOnFocusLeave);
  scope.listen(button, 'focusout', closeOnFocusLeave);

  function addRow(row: HTMLButtonElement, label: string) {
    row.type = 'button';
    row.classList.add('theater-settings-row');
    row.querySelector('svg')?.setAttribute('aria-hidden', 'true');
    const main = document.createElement('span');
    main.className = 'theater-settings-main';
    const text = document.createElement('span');
    text.className = 'theater-settings-label';
    text.textContent = label;
    const keys = document.createElement('span');
    keys.className = 'theater-settings-keys';
    keys.dir = 'ltr';
    main.append(text, keys);
    const detail = document.createElement('span');
    detail.className = 'theater-settings-detail';
    row.append(main, detail);
    panel.append(row);
    return {
      update(shortcut: string, value?: string) {
        keys.replaceChildren();
        shortcutDisplayParts(shortcut).forEach((part, index) => {
          if (index > 0) keys.append('+');
          const key = document.createElement('kbd');
          key.textContent = part;
          keys.append(key);
        });
        detail.replaceChildren();
        if (value) detail.textContent = value;
        row.setAttribute('aria-keyshortcuts', shortcut);
      }
    };
  }
  return { button, panel, container, close, addRow };
}
