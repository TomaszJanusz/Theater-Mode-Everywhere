import type { DisposableScope } from '../core/disposable-scope';
import { closeMenuPopover, bindMenuPopover } from './menu-popover';
import type { PlayerChromeContext } from './runtime-context';
import { shortcutDisplayParts } from './shortcuts';

/** Close the settings panel, optionally returning keyboard focus to its trigger. */
export function closePlayerSettings(root: ParentNode, restoreFocus = false): boolean {
  return closeMenuPopover(root.querySelector<HTMLElement>('.theater-settings-container'), restoreFocus);
}

export function createPlayerSettings(
  ctx: PlayerChromeContext,
  scope: DisposableScope,
  options?: { onBeforeOpen?: () => void }
) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'theater-control-btn player-settings-btn';
  button.setAttribute('aria-label', ctx.t('playerSettingsLabel'));
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', 'theater-player-settings');
  ctx.actions.setIcon(button, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>`);

  const panel = document.createElement('div');
  panel.id = 'theater-player-settings';
  panel.className = 'theater-settings-menu';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', ctx.t('playerSettingsLabel'));
  const body = document.createElement('div');
  body.className = 'theater-settings-body';
  const chatSection = document.createElement('div');
  chatSection.className = 'theater-settings-section';
  chatSection.dataset.settingsSection = 'chat';
  chatSection.hidden = true;
  const chatHeading = document.createElement('div');
  chatHeading.className = 'theater-settings-heading';
  chatHeading.textContent = ctx.t('settingsSectionChat');
  const chatBody = document.createElement('div');
  chatBody.className = 'theater-settings-section-body';
  chatSection.append(chatHeading, chatBody);
  const separator = document.createElement('div');
  separator.className = 'theater-settings-separator';
  separator.hidden = true;
  separator.setAttribute('role', 'separator');
  const playerHeading = document.createElement('div');
  playerHeading.className = 'theater-settings-heading';
  playerHeading.textContent = ctx.t('settingsSectionPlayer');
  body.append(chatSection, separator, playerHeading);
  panel.append(body);
  ctx.paintOverlay(panel);

  const container = document.createElement('div');
  container.className = 'theater-settings-container';
  container.append(button, panel);

  const popover = bindMenuPopover({
    host: container,
    trigger: button,
    panel,
    scope,
    onBeforeOpen: () => options?.onBeforeOpen?.(),
    onKeyboardOpen: () => ctx.actions.showToolbar(),
    onChange: () => ctx.actions.updateCaptionDock()
  });
  const close = popover.close;

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
    body.append(row);
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
