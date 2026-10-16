import { isNewFeature, type FeatureHighlights, type NewFeatureId } from '../feature-highlights';
import { createNewBadge } from './new-badge';
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

  // Anchor the dot to the icon: the menu's open trigger grows into its notch.
  const gearIcon = document.createElement('span');
  gearIcon.className = 'theater-settings-gear-icon';
  gearIcon.setAttribute('aria-hidden', 'true');
  gearIcon.append(...button.childNodes);
  button.append(gearIcon);

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
  const createSeparator = () => {
    const separator = document.createElement('div');
    separator.className = 'theater-settings-separator';
    separator.hidden = true;
    separator.setAttribute('role', 'separator');
    return separator;
  };
  // Hidden until a provider adds audio rows; DRM or CORS-refused media shows a note instead.
  const audioSection = document.createElement('div');
  audioSection.className = 'theater-settings-section';
  audioSection.dataset.settingsSection = 'audio';
  audioSection.hidden = true;
  const audioHeading = document.createElement('div');
  audioHeading.className = 'theater-settings-heading';
  audioHeading.textContent = ctx.t('settingsSectionAudio');
  const audioBody = document.createElement('div');
  audioBody.className = 'theater-settings-section-body';
  // Replaces the audio rows when the video's audio cannot be processed, so the reason is stated once.
  const audioNote = document.createElement('p');
  audioNote.className = 'theater-settings-note';
  audioNote.hidden = true;
  audioSection.append(audioHeading, audioBody, audioNote);
  const audioSeparator = createSeparator();
  const playerHeading = document.createElement('div');
  playerHeading.className = 'theater-settings-heading';
  playerHeading.textContent = ctx.t('settingsSectionPlayer');
  body.append(chatSection, createSeparator(), audioSection, audioSeparator, playerHeading);
  let footerStart: HTMLElement | null = null;
  // Later player actions insert above this row, so shortcuts stay last.
  let shortcutsAnchor: HTMLElement | null = null;
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
    // A blocked audio section hides its rows, which cannot take focus.
    firstFocus: () => [...panel.querySelectorAll('button')].find(row => !row.closest('[hidden]')),
    onKeyboardOpen: () => ctx.actions.showToolbar(),
    onChange: () => ctx.actions.updateCaptionDock()
  });
  const close = popover.close;

  const newItems = new Map<HTMLElement, { id: NewFeatureId; text: HTMLElement; label: string; visible: boolean }>();
  let lastHighlights: FeatureHighlights | undefined;
  let gearDot: HTMLElement | null = null;
  function refreshHighlights(force = false) {
    const state = ctx.ui().featureHighlights;
    if (!force && state === lastHighlights) return;
    lastHighlights = state;
    for (const [row, item] of newItems) {
      const visible = isNewFeature(item.id, state);
      if (visible !== item.visible) {
        item.visible = visible;
        item.text.querySelector('.te-new-badge')?.remove();
        if (visible) item.text.append(createNewBadge());
      }
      row.setAttribute('aria-label', item.label + (visible ? `, ${ctx.t('badgeNew')}` : ''));
    }
    const anyNew = [...newItems].some(([row, item]) => item.visible && !row.closest('[hidden]'));
    if (anyNew && !gearDot) { gearDot = createNewBadge('dot'); gearIcon.append(gearDot); }
    if (!anyNew) { gearDot?.remove(); gearDot = null; }
    if (anyNew) button.setAttribute('aria-description', ctx.t('badgeNew'));
    else button.removeAttribute('aria-description');
  }

  function highlight(element: HTMLElement, text: HTMLElement, label: string, id: NewFeatureId) {
    if (!newItems.size) scope.add(ctx.uiStore.subscribe(() => refreshHighlights()));
    newItems.set(element, { id, text, label, visible: false });
    refreshHighlights(true);
  }

  /** Audio rows precede player actions. Shortcuts stay the last action; footer rows close the panel. */
  function addRow(row: HTMLButtonElement, label: string, section: 'player' | 'audio' | 'footer' | 'shortcuts' = 'player', newItem?: NewFeatureId) {
    row.type = 'button';
    row.setAttribute('aria-label', label);
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
    keys.setAttribute('aria-hidden', 'true');
    main.append(text, keys);
    const detail = document.createElement('span');
    detail.className = 'theater-settings-detail';
    row.append(main, detail);
    if (section === 'audio') {
      audioBody.append(row);
      audioSection.hidden = false;
      audioSeparator.hidden = false;
      if (!newItems.has(audioHeading)) highlight(audioHeading, audioHeading, ctx.t('settingsSectionAudio'), 'playerAudio');
    } else if (section === 'footer') {
      body.append(row);
      footerStart ??= row;
    } else if (section === 'shortcuts') {
      body.insertBefore(row, footerStart);
      shortcutsAnchor = row;
    } else {
      body.insertBefore(row, shortcutsAnchor ?? footerStart);
    }
    if (newItem) highlight(row, text, label, newItem);
    return {
      update(shortcut: string, value?: string) {
        const name = value ? `${label}: ${value}` : label;
        const item = newItems.get(row);
        if (item) item.label = name;
        row.setAttribute('aria-label', name + (item?.visible ? `, ${ctx.t('badgeNew')}` : ''));
        keys.replaceChildren();
        shortcutDisplayParts(shortcut).forEach((part, index) => {
          if (index > 0) keys.append('+');
          const key = document.createElement('kbd');
          key.textContent = part;
          keys.append(key);
        });
        detail.replaceChildren();
        if (value) detail.textContent = value;
        if (shortcut) row.setAttribute('aria-keyshortcuts', shortcut);
        else row.removeAttribute('aria-keyshortcuts');
      }
    };
  }
  let lastAudioNote: string | null | undefined;
  /** Show why audio rows are unavailable, or restore them when `reason` is null. */
  function setAudioNote(reason: string | null) {
    if (reason === lastAudioNote) return;
    lastAudioNote = reason;
    audioBody.hidden = reason !== null;
    audioNote.hidden = reason === null;
    audioNote.textContent = reason;
    if (newItems.size) refreshHighlights(true);
  }
  return { button, panel, container, close, addRow, setAudioNote };
}
