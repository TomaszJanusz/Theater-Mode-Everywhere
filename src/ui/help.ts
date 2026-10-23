import { activeElementDeep } from '../accessibility';
import { requestOptionsPage } from '../protocol/options-page';

import { renderKbdText, renderShortcutCaps } from './kbd-text';
import { createModal, type Modal } from './modal';
import type { PlayerChromeContext } from './runtime-context';
import { shortcutMarkup } from './shortcut-display';
import { SHORTCUT_HELP_GROUPS, SHORTCUT_LABELS, shortcutHelpRowLabel, type ShortcutHelpRow } from './shortcut-groups';
import { defaultShortcuts, shortcutDisplayEnv, type Shortcuts } from './shortcuts';

let helpSequence = 0;

type Translate = PlayerChromeContext['t'];

function unassigned(text: string): HTMLElement {
  const span = document.createElement('span');
  span.className = 'theater-help-unassigned';
  span.textContent = text;
  return span;
}

/** One cap row per action; a shared row names each half, so a screen reader hears which key does what. */
function renderKeys(t: Translate, row: ShortcutHelpRow, shortcuts: Shortcuts): HTMLElement {
  const keys = document.createElement('dd');
  keys.className = 'theater-help-keys';
  keys.dir = 'ltr';
  if (!row.actions.some(action => shortcuts[action])) {
    keys.append(unassigned(t('shortcutUnassigned')));
    return keys;
  }
  row.actions.forEach((action, index) => {
    const binding = document.createElement('span');
    binding.className = 'theater-help-binding';
    if (row.actions.length > 1) {
      binding.setAttribute('role', 'group');
      binding.setAttribute('aria-label', t(SHORTCUT_LABELS[action]));
      binding.title = t(SHORTCUT_LABELS[action]);
    }
    if (shortcuts[action]) renderShortcutCaps(binding, shortcuts[action]);
    else {
      // Half of a pair is unassigned: a dash keeps its place, and the group still says so.
      const gap = unassigned('–');
      gap.setAttribute('role', 'img');
      gap.setAttribute('aria-label', t('shortcutUnassigned'));
      binding.append(gap);
    }
    // Opposites read as alternatives; the slash leads the second binding, so a wrapped pair starts its line with it.
    // The navigation cluster is just four keys.
    if (index > 0 && row.actions.length === 2) {
      const or = document.createElement('span');
      or.className = 'theater-help-or';
      or.setAttribute('aria-hidden', 'true');
      or.textContent = '/';
      binding.prepend(or);
    }
    keys.append(binding);
  });
  return keys;
}

/** How to enter and leave the controls bar and its menus, in the keys the user actually has. */
function navigationHint(t: Translate, shortcuts: Shortcuts): HTMLElement | null {
  if (!shortcuts.navigateUp || !shortcuts.navigateDown) return null;
  const env = shortcutDisplayEnv();
  const hint = document.createElement('p');
  hint.className = 'theater-help-hint';
  renderKbdText(hint, t('helpNavigationHint', [shortcuts.navigateUp, shortcuts.navigateDown, 'Escape'].map(key => shortcutMarkup(key, env))));
  return hint;
}

function renderGroups(t: Translate, shortcuts: Shortcuts): HTMLElement {
  const grid = document.createElement('div');
  grid.className = 'theater-help-grid';
  const sequence = ++helpSequence;
  for (const group of SHORTCUT_HELP_GROUPS) {
    const groupEl = document.createElement('div');
    groupEl.className = 'theater-help-group';
    groupEl.dataset.group = group.id;
    groupEl.setAttribute('role', 'group');
    const title = document.createElement('h3');
    title.className = 'theater-help-group-title';
    title.id = `theater-help-${sequence}-${group.id}`;
    title.textContent = t(group.title);
    groupEl.setAttribute('aria-labelledby', title.id);
    const list = document.createElement('dl');
    list.className = 'theater-help-list';
    for (const row of group.rows) {
      const rowEl = document.createElement('div');
      rowEl.className = 'theater-help-row';
      rowEl.dataset.actions = row.actions.join(' ');
      const label = document.createElement('dt');
      label.className = 'theater-help-label';
      label.textContent = t(shortcutHelpRowLabel(row));
      rowEl.append(label, renderKeys(t, row, shortcuts));
      list.append(rowEl);
    }
    groupEl.append(title, list);
    if (group.id === 'navigation') {
      const hint = navigationHint(t, shortcuts);
      if (hint) groupEl.append(hint);
    }
    grid.append(groupEl);
  }
  return grid;
}

/** The shortcuts help: groups from `SHORTCUT_HELP_GROUPS` in the shared modal; the stylesheet decides the columns. */
export function createHelp(ctx: PlayerChromeContext) {
  let modal: Modal | null = null;

  function toggleHelpOverlay(): void {
    const overlay = ctx.queryPlayerUi('.theater-help-overlay') as HTMLElement | null;
    if (overlay) {
      hideHelpOverlay();
    } else {
      showHelpOverlay();
    }
  }

  function showHelpOverlay(): void {
    if (ctx.refs.helpOverlay?.isConnected) return;
    if (ctx.refs.helpOverlay) hideHelpOverlay(false);

    const returnFocus = activeElementDeep();
    const returnTrigger = returnFocus?.closest('.theater-settings-menu, .player-settings-btn')
      ? '.player-settings-btn'
      : returnFocus?.closest('.theater-cc-menu') ? '.cc-btn' : null;

    ctx.actions.closeTheaterPopovers();
    ctx.actions.showToolbar();

    const shortcuts = ctx.ui().shortcuts || defaultShortcuts;
    modal = createModal({
      title: ctx.t('keyboardShortcutsTitle'),
      closeLabel: ctx.t('dialogClose'),
      content: renderGroups(ctx.t, shortcuts),
      actions: [{ label: ctx.t('helpCustomizeShortcuts'), kind: 'secondary', value: false, run: () => requestOptionsPage('shortcuts') }],
      size: 'large',
      scrollable: true,
      initialFocus: 'close',
      dismissShortcut: shortcuts.showHelp,
      mount: ctx.mountPlayerUi,
      decorate: overlay => { overlay.classList.add('theater-help-overlay'); ctx.paintOverlay(overlay); },
      returnFocus: () => returnTrigger ? ctx.queryPlayerUi<HTMLElement>(returnTrigger) : returnFocus,
      onClose: () => {
        modal = null;
        ctx.refs.helpOverlay = null;
        ctx.uiStore.dispatch({ type: 'SET_HELP_OPEN', value: false });
        ctx.actions.scheduleToolbarHide();
      }
    });
    ctx.refs.helpOverlay = modal.overlay;
    ctx.uiStore.dispatch({ type: 'SET_HELP_OPEN', value: true });
  }

  function hideHelpOverlay(restoreFocus = true): void {
    if (modal) modal.close(false, restoreFocus);
    else {
      ctx.refs.helpOverlay = null;
      ctx.uiStore.dispatch({ type: 'SET_HELP_OPEN', value: false });
    }
  }

  return { toggleHelpOverlay, showHelpOverlay, hideHelpOverlay };
}
