import type { DisposableScope } from '../core/disposable-scope';
import { isNewFeature, type FeatureHighlights, type NewFeatureId } from '../feature-highlights';

import { renderShortcutCaps } from './kbd-text';
import { closeMenuPopover, bindMenuPopover, MENU_CLOSE_EVENT } from './menu-popover';
import { createNewBadge } from './new-badge';
import type { PlayerChromeContext } from './runtime-context';
import { shortcutAriaKeyshortcuts, shortcutKeyHint } from './shortcut-display';
import { shortcutDisplayEnv } from './shortcuts';
import { createStepper, type StepperState } from './stepper';

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
  // Track choice comes from the provider, not Web Audio, so a blocked audio graph does not hide it.
  const audioTrackBody = document.createElement('div');
  audioTrackBody.className = 'theater-settings-section-body';
  // Named groups: track choice and audio processing are different kinds of rows in one section.
  audioTrackBody.dataset.settingsGroup = 'tracks';
  const audioBody = document.createElement('div');
  audioBody.className = 'theater-settings-section-body';
  audioBody.dataset.settingsGroup = 'processing';
  // Replaces the audio rows when the video's audio cannot be processed, so the reason is stated once.
  const audioNote = document.createElement('p');
  audioNote.className = 'theater-settings-note';
  audioNote.hidden = true;
  audioSection.append(audioHeading, audioTrackBody, audioBody, audioNote);
  const audioSeparator = createSeparator();
  const playerHeading = document.createElement('div');
  playerHeading.className = 'theater-settings-heading';
  playerHeading.textContent = ctx.t('settingsSectionPlayer');
  body.append(chatSection, createSeparator(), audioSection, audioSeparator, playerHeading);
  let footerStart: HTMLElement | null = null;
  // Later player actions insert above this row, so shortcuts stay last.
  let shortcutsAnchor: HTMLElement | null = null;
  // A nested list replaces the rows until Back, Escape or closing returns to them.
  const subview = document.createElement('div');
  subview.className = 'theater-settings-subview';
  subview.hidden = true;
  let subviewReturn: HTMLElement | null = null;
  panel.append(body, subview);
  ctx.paintOverlay(panel);

  const container = document.createElement('div');
  container.className = 'theater-settings-container';
  container.append(button, panel);

  const firstRow = () => [...panel.querySelectorAll('button:not(:disabled):not([aria-disabled="true"])')].find(row => !row.closest('[hidden]')) as HTMLElement | undefined;
  const popover = bindMenuPopover({
    host: container,
    trigger: button,
    panel,
    scope,
    onBeforeOpen: () => options?.onBeforeOpen?.(),
    // A blocked audio section hides its rows, which cannot take focus.
    firstFocus: firstRow,
    onKeyboardOpen: () => ctx.actions.showToolbar(),
    onChange: () => ctx.actions.updateCaptionDock()
  });
  const close = popover.close;

  function openSubview(returnTo: HTMLElement, focus: () => HTMLElement | undefined) {
    subviewReturn = returnTo;
    body.hidden = true;
    subview.hidden = false;
    (focus() ?? subview.querySelector('button'))?.focus({ preventScroll: true });
    ctx.actions.updateCaptionDock();
  }
  function closeSubview(restoreFocus: boolean) {
    if (subview.hidden) return;
    const returnTo = subviewReturn;
    const hadFocus = subview.contains((subview.getRootNode() as Document | ShadowRoot).activeElement);
    subviewReturn = null;
    subview.hidden = true;
    body.hidden = false;
    if (restoreFocus || hadFocus) (returnTo && !returnTo.closest('[hidden]') ? returnTo : firstRow())?.focus({ preventScroll: true });
    ctx.actions.updateCaptionDock();
  }
  // Every close returns the next opening to the rows; the popover itself decides where focus goes.
  scope.listen(panel, MENU_CLOSE_EVENT, () => {
    subviewReturn = null;
    subview.hidden = true;
    body.hidden = false;
  });

  const newItems = new Map<HTMLElement, { id: NewFeatureId; target: HTMLElement; label: string; visible: boolean; dot: boolean }>();
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
        item.target.querySelector('.te-new-badge')?.remove();
        if (visible) item.target.append(createNewBadge(item.dot ? 'dot' : 'pill'));
      }
      row.setAttribute('aria-label', item.label + (visible ? `, ${ctx.t('badgeNew')}` : ''));
    }
    const anyNew = [...newItems].some(([row, item]) => item.visible && !row.closest('[hidden]'));
    if (anyNew && !gearDot) { gearDot = createNewBadge('dot'); gearIcon.append(gearDot); }
    if (!anyNew) { gearDot?.remove(); gearDot = null; }
    if (anyNew) button.setAttribute('aria-description', ctx.t('badgeNew'));
    else button.removeAttribute('aria-description');
  }

  function highlight(element: HTMLElement, target: HTMLElement, label: string, id: NewFeatureId, dot = false) {
    if (!newItems.size) scope.add(ctx.uiStore.subscribe(() => refreshHighlights()));
    newItems.set(element, { id, target, label, visible: false, dot });
    refreshHighlights(true);
  }

  /** Audio rows precede player actions. Shortcuts stay the last action; footer rows close the panel. */
  type RowSection = 'player' | 'audioTracks' | 'audio' | 'footer' | 'shortcuts';
  function addRow(row: HTMLButtonElement, label: string, section: RowSection = 'player', newItem?: NewFeatureId) {
    row.type = 'button';
    return mountRow(row, label, section, { newItem });
  }

  /**
   * A row for a setting with several ordered options: arrows step it down and up without wrapping.
   * Not a button, so the arrows inside it stay valid, focusable controls.
   */
  function addStepperRow(row: HTMLElement, label: string, section: RowSection, step: { onStep: (direction: 1 | -1) => void; newItem?: NewFeatureId }) {
    row.setAttribute('role', 'group');
    return mountRow(row, label, section, step);
  }

  function mountRow(row: HTMLElement, label: string, section: RowSection, { newItem, onStep }: { newItem?: NewFeatureId; onStep?: (direction: 1 | -1) => void }) {
    row.setAttribute('aria-label', label);
    row.classList.add('theater-settings-row');
    const icon = document.createElement('span');
    icon.className = 'theater-settings-row-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.append(...row.childNodes);
    row.append(icon);
    const main = document.createElement('span');
    main.className = 'theater-settings-main';
    const text = document.createElement('span');
    text.className = 'theater-settings-label';
    text.textContent = label;
    text.title = label;
    const keys = document.createElement('span');
    keys.className = 'theater-settings-keys';
    keys.dir = 'ltr';
    keys.setAttribute('aria-hidden', 'true');
    main.append(text, keys);
    const detail = document.createElement('span');
    detail.className = 'theater-settings-detail';
    const stepper = onStep && createStepper({
      scope,
      previousLabel: ctx.t('stepperPrevious', label),
      nextLabel: ctx.t('stepperNext', label),
      onStep
    });
    if (stepper) row.classList.add('theater-settings-stepper-row');
    row.append(main, stepper?.element ?? detail);
    if (section === 'audio' || section === 'audioTracks') {
      (section === 'audio' ? audioBody : audioTrackBody).append(row);
      syncAudioSection();
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
    if (newItem) highlight(row, icon, label, newItem, true);
    function setShortcut(shortcut: string, name: string) {
      const item = newItems.get(row);
      if (item) item.label = name;
      row.setAttribute('aria-label', name + (item?.visible ? `, ${ctx.t('badgeNew')}` : ''));
      renderShortcutCaps(keys, shortcut);
      if (shortcut) row.setAttribute('aria-keyshortcuts', shortcutAriaKeyshortcuts(shortcut));
      else row.removeAttribute('aria-keyshortcuts');
    }
    return {
      /** `shortcut` is the cycle key the row advertises; the arrows themselves are the stepper's own controls. */
      updateStepper(shortcut: string, state: StepperState) {
        // A blocked row names its reason, since the arrows alone cannot say why they do nothing.
        setShortcut(shortcut, state.disabled ? `${label}: ${state.value}` : label);
        if (state.disabled) row.setAttribute('aria-disabled', 'true');
        else row.removeAttribute('aria-disabled');
        stepper?.update(state);
        const { navigateLeft, navigateRight } = ctx.ui().shortcuts;
        const env = shortcutDisplayEnv();
        stepper?.setKeys(shortcutKeyHint(navigateLeft, env), shortcutKeyHint(navigateRight, env));
      },
      /** `values` lists every state the row can show; the widest sets the value's width so toggling never resizes the menu. */
      update(shortcut: string, value?: string, values: readonly string[] = []) {
        setShortcut(shortcut, value ? `${label}: ${value}` : label);
        detail.replaceChildren();
        if (value) {
          const current = document.createElement('span');
          current.textContent = value;
          detail.append(current);
          for (const other of values) {
            const reserve = document.createElement('span');
            reserve.className = 'theater-settings-reserve';
            reserve.setAttribute('aria-hidden', 'true');
            // Painted from the attribute so the reserve never joins the value's text content.
            reserve.dataset.reserve = other;
            detail.append(reserve);
          }
        }
      }
    };
  }
  /** The audio section shows while any of its rows can: a track row hides with fewer than two tracks. */
  function syncAudioSection() {
    const shown = [...audioTrackBody.children, ...audioBody.children].some(row => !(row as HTMLElement).hidden);
    if (audioSection.hidden !== !shown) {
      audioSection.hidden = !shown;
      audioSeparator.hidden = !shown;
      if (newItems.size) refreshHighlights(true);
    }
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
  /** Shows or hides a row; the audio section follows its rows. */
  function setRowHidden(row: HTMLElement, hidden: boolean) {
    if (row.hidden === hidden) return;
    row.hidden = hidden;
    // A list whose row disappears (an ad started, the item changed) has nothing left to choose from.
    if (hidden && subviewReturn && row.contains(subviewReturn)) closeSubview(false);
    syncAudioSection();
    // A hidden row does not count towards the gear dot, so its visibility is part of that state.
    if (newItems.has(row)) refreshHighlights(true);
  }
  return { button, panel, container, close, addRow, addStepperRow, setAudioNote, setRowHidden, subview, openSubview, closeSubview };
}
