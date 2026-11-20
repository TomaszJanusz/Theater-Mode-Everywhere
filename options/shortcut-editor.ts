import { openDialog } from '../src/dialog';
import { t } from '../src/i18n';
import { shortcutLabel, type ShortcutDisplayEnv } from '../src/ui/shortcut-display';
import { assignShortcut, defaultShortcuts, isNavigationShortcut, isReservedShortcut, loadKeyboardLayout, resolveSeekHold, SEEK_HOLD_STORAGE_KEY, shortcutConflicts, shortcutDisplayEnv, shortcutFromEvent, withShortcutDefaults, type Shortcuts } from '../src/ui/shortcuts';
import type { ShortcutUpdate, ShortcutUpdateResult } from '../src/ui/shortcut-updates';

import { matchesShortcutSearch, normalizeSearchText, shortcutSearchTerms } from './shortcut-search';

/** The Hold for 2x speed switch under Seek Forward; Settings saves it like the other feature switches. */
export const SEEK_HOLD_TOGGLE = { id: 'seek-hold-toggle', key: SEEK_HOLD_STORAGE_KEY, resolve: resolveSeekHold } as const;

export function createShortcutEditor(onSaved: () => Promise<void>) {
  const entries = Array.from(document.querySelectorAll<HTMLInputElement>('.options-input')).map(input => {
    const reset = input.parentElement!.querySelector<HTMLButtonElement>('.reset-single-btn')!;
    const action = reset.dataset.shortcut as keyof Shortcuts;
    const label = document.querySelector<HTMLLabelElement>(`label[for="${input.id}"]`)!.textContent!.trim();
    reset.setAttribute('aria-label', `${t('resetToDefault')}: ${label}`);
    return { input, reset, action, label };
  }).filter(entry => Object.hasOwn(defaultShortcuts, entry.action));
  const notice = document.createElement('p');
  notice.id = 'shortcut-conflict-status';
  notice.className = 'options-conflict-status';
  notice.setAttribute('role', 'status');
  notice.setAttribute('aria-atomic', 'true');
  entries[0]?.input.closest('.options-body')?.before(notice);
  const grid = entries[0]?.input.closest<HTMLElement>('.options-body');
  grid?.setAttribute('aria-busy', 'true');
  const search = document.getElementById('shortcut-search') as HTMLInputElement | null;
  const searchStatus = document.getElementById('shortcut-search-status');
  type SearchItem = { rows: HTMLElement[]; action: keyof Shortcuts };
  // Collected on the first filter, so a page without the search field needs nothing more from the list than before.
  let searchItems: SearchItem[] | undefined;
  // Rows on screen when an edit starts stay until the query changes, so saving a key never hides the row being edited.
  const keptBySearch = new Set<SearchItem>();
  let busy = false;
  let current = { ...defaultShortcuts };
  let epoch = 0;
  const writes: Array<{ epoch: number; action: keyof Shortcuts; shortcut: string }> = [];

  function sameShortcuts(left: Shortcuts, right: Shortcuts): boolean {
    return (Object.keys(defaultShortcuts) as Array<keyof Shortcuts>).every((key) => left[key] === right[key]);
  }

  function noteCommitted(next: Shortcuts): void {
    epoch += 1;
    (Object.keys(next) as Array<keyof Shortcuts>).forEach((action) => {
      if (next[action] !== current[action]) writes.push({ epoch, action, shortcut: next[action] });
    });
    current = next;
  }

  async function read(): Promise<Shortcuts> {
    const saved = await chrome.storage.sync.get('shortcuts');
    return withShortcutDefaults(saved.shortcuts);
  }

  async function update(request: ShortcutUpdate): Promise<ShortcutUpdateResult> {
    const result: ShortcutUpdateResult = await chrome.runtime.sendMessage({ action: 'update-shortcuts', request });
    if (!result || result.status === 'error') throw new Error('Shortcut update failed');
    return result;
  }

  const label = (shortcut: string) => shortcutLabel(shortcut, shortcutDisplayEnv());

  /** Shows the keycap legends, never the stored form; a long combination ellipsizes, so `title` keeps it whole. */
  function show(input: HTMLInputElement, shortcut: string): void {
    input.value = label(shortcut);
    input.title = input.value;
    // Keys read left to right in every locale; the localized placeholder keeps the page direction.
    if (shortcut) input.dir = 'ltr';
    else input.removeAttribute('dir');
  }

  function render(shortcuts: Shortcuts) {
    current = shortcuts;
    let conflictsFound = false;
    for (const entry of entries) {
      show(entry.input, shortcuts[entry.action]);
      entry.input.placeholder = shortcuts[entry.action] ? t('pressKeysPlaceholder') : t('shortcutUnassigned');
      const conflicts = shortcutConflicts(shortcuts, entry.action, shortcuts[entry.action]);
      entry.input.setAttribute('aria-invalid', String(conflicts.length > 0));
      if (conflicts.length) entry.input.setAttribute('aria-describedby', notice.id);
      else entry.input.removeAttribute('aria-describedby');
      conflictsFound ||= conflicts.length > 0;
    }
    notice.textContent = conflictsFound ? t('shortcutExistingConflicts') : '';
    // Keep the live region mounted even when there is no message to announce.
    notice.style.margin = conflictsFound ? '' : '0';
    filter();
  }

  function collectSearchItems(list: HTMLElement): SearchItem[] {
    const items: SearchItem[] = [];
    // A switch row without its own shortcut (Hold for 2x speed) belongs to the shortcut above it and is filtered with it.
    for (const row of list.querySelectorAll<HTMLElement>('.options-row')) {
      const entry = entries.find(candidate => row.contains(candidate.input));
      if (entry) items.push({ rows: [row], action: entry.action });
      else items.at(-1)?.rows.push(row);
    }
    return items;
  }

  function filter(): void {
    if (!search || !grid) return;
    searchItems ??= collectSearchItems(grid);
    const query = search.value;
    // Spoken key names follow the Settings language, so `strzałka` finds the arrows in Polish.
    const env: ShortcutDisplayEnv = { ...shortcutDisplayEnv(), spoken: message => t(message) };
    let shown = 0;
    for (const item of searchItems) {
      const text = item.rows.flatMap(row => [...row.querySelectorAll('.options-label, .options-desc')].map(element => element.textContent ?? ''));
      const visible = keptBySearch.has(item) || matchesShortcutSearch(query, { text, keys: shortcutSearchTerms(current[item.action], env) });
      for (const row of item.rows) row.hidden = !visible;
      if (visible) shown += 1;
    }
    for (const group of grid.querySelectorAll<HTMLElement>('.options-group')) group.hidden = !group.querySelector('.options-row:not([hidden])');
    grid.hidden = shown === 0;
    if (!searchStatus) return;
    if (!normalizeSearchText(query)) searchStatus.textContent = '';
    else searchStatus.textContent = shown ? t('shortcutSearchShown', [String(shown), String(searchItems.length)]) : t('shortcutSearchEmpty');
  }

  function applyStored(value: unknown): void {
    epoch += 1;
    writes.length = 0;
    const record = value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined;
    const shortcuts = withShortcutDefaults(record);
    if (busy) {
      current = shortcuts;
      return;
    }
    render(shortcuts);
  }

  async function refresh(): Promise<void> {
    if (busy) return;
    const seen = epoch;
    const painted = current;
    const pending = writes.slice();
    try {
      const shortcuts = typeof chrome === 'undefined' ? defaultShortcuts : await read();
      if (seen !== epoch || busy) return;
      if (pending.some((write) => shortcuts[write.action] !== write.shortcut)) return;
      // A get() that started after a local or storage paint can still resolve with an older map.
      if (seen > 0 && pending.length === 0 && !sameShortcuts(shortcuts, painted)) return;
      writes.length = 0;
      render(shortcuts);
    } catch (error) { console.error('Unable to read shortcuts:', error); }
  }

  async function save(action: keyof Shortcuts, shortcut: string) {
    if (isReservedShortcut(action, shortcut)) {
      await openDialog(() => ({ title: t('shortcutConflictTitle'), content: t('shortcutEscapeReserved'), actions: { type: 'acknowledge' } }));
      return;
    }
    let confirmedOwners: Array<keyof Shortcuts> = [];
    for (;;) {
      const result = await update({ type: 'assign', action, shortcut, confirmedOwners });
      if (result.status === 'reserved') return;
      if (result.status === 'conflict') {
        const conflicts = result.owners;
        const confirmed = await openDialog(() => ({
          title: t('shortcutConflictTitle'),
          content: t('shortcutConflictDescription', [label(shortcut),
            conflicts.map(key => entries.find(entry => entry.action === key)?.label || key).join(', '),
            entries.find(entry => entry.action === action)!.label]),
          actions: { type: 'choice', falseLabel: t('shortcutKeepAssignment'), trueLabel: t('shortcutReassign'), initialFocus: 'cancel' }
        }));
        if (!confirmed) return;
        confirmedOwners = conflicts;
        continue; // The single background writer revalidates after a user's choice.
      }
      noteCommitted(assignShortcut(current, action, shortcut));
      await onSaved();
      return;
    }
  }

  async function edit(origin: HTMLElement, operation: () => Promise<void>) {
    if (busy) return;
    busy = true;
    for (const item of searchItems ?? []) if (!item.rows[0].hidden) keptBySearch.add(item);
    grid?.setAttribute('aria-busy', 'true');
    try { await operation(); }
    catch (error) {
      console.error('Unable to save shortcuts:', error);
      await openDialog(() => ({ title: t('shortcutSaveError'), content: t('shortcutSaveErrorDescription'), actions: { type: 'acknowledge' } }));
    } finally {
      render(current);
      busy = false;
      await refresh();
      grid?.setAttribute('aria-busy', 'false');
      const active = document.activeElement;
      if (origin.isConnected && (active == null || active === document.body || active === origin)) origin.focus();
    }
  }

  async function initialize() {
    await loadKeyboardLayout();
    render(defaultShortcuts);
    await refresh();
    for (const entry of entries) {
      entry.input.addEventListener('keydown', event => {
        if (event.key === 'Tab') return; // Recording must not trap keyboard navigation.
        event.preventDefault();
        event.stopPropagation();
        if (event.repeat || busy) return;
        // The Navigation group records positions, so the cluster follows the keyboard's shape on any layout.
        const shortcut = shortcutFromEvent(event, isNavigationShortcut(entry.action));
        if (!shortcut) return;
        show(entry.input, shortcut);
        void edit(entry.input, () => save(entry.action, shortcut));
      });
      entry.input.addEventListener('blur', () => { if (!busy) render(current); });
      entry.reset.addEventListener('click', () => void edit(entry.reset, () => save(entry.action, defaultShortcuts[entry.action])));
    }
    search?.addEventListener('input', () => { keptBySearch.clear(); filter(); });
    search?.addEventListener('keydown', event => {
      // Esc clears a query in every browser; on an empty field it is left to the page.
      if (event.key !== 'Escape' || !search.value) return;
      event.preventDefault();
      search.value = '';
      keptBySearch.clear();
      filter();
    });
    document.getElementById('reset-shortcuts-btn')?.addEventListener('click', event => {
      void edit(event.currentTarget as HTMLElement, async () => {
        await update({ type: 'resetAll' });
        noteCommitted({ ...defaultShortcuts });
        await onSaved();
      });
    });
    // The keyboard layout can change while Settings is in the background.
    document.defaultView?.addEventListener('focus', () => void loadKeyboardLayout().then(() => { if (!busy) render(current); }));
    grid?.setAttribute('aria-busy', 'false');
  }
  function localize(): void {
    for (const entry of entries) {
      entry.label = document.querySelector<HTMLLabelElement>(`label[for="${entry.input.id}"]`)!.textContent!.trim();
      entry.reset.setAttribute('aria-label', `${t('resetToDefault')}: ${entry.label}`);
    }
    render(current);
  }
  return { initialize, refresh, applyStored, localize };
}
