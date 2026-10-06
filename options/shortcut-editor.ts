import { openDialog } from '../src/dialog';
import { t } from '../src/i18n';
import { assignShortcut, defaultShortcuts, isReservedShortcut, shortcutConflicts, shortcutFromEvent, withShortcutDefaults, type Shortcuts } from '../src/ui/shortcuts';
import type { ShortcutUpdate, ShortcutUpdateResult } from '../src/ui/shortcut-updates';

export function createShortcutEditor(onSaved: () => Promise<void>) {
  const entries = Array.from(document.querySelectorAll<HTMLInputElement>('.shortcut-input')).map(input => {
    const reset = input.parentElement!.querySelector<HTMLButtonElement>('.reset-single-btn')!;
    const action = reset.dataset.shortcut as keyof Shortcuts;
    const label = document.querySelector<HTMLLabelElement>(`label[for="${input.id}"]`)!.textContent!.trim();
    reset.setAttribute('aria-label', `${t('resetToDefault')}: ${label}`);
    return { input, reset, action, label };
  }).filter(entry => Object.hasOwn(defaultShortcuts, entry.action));
  const notice = document.createElement('p');
  notice.id = 'shortcut-conflict-status';
  notice.className = 'shortcut-conflict-status';
  notice.setAttribute('role', 'status');
  entries[0]?.input.closest('.shortcuts-grid')?.before(notice);
  const grid = entries[0]?.input.closest('.shortcuts-grid');
  grid?.setAttribute('aria-busy', 'true');
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

  function render(shortcuts: Shortcuts) {
    current = shortcuts;
    let conflictsFound = false;
    for (const entry of entries) {
      entry.input.value = shortcuts[entry.action];
      entry.input.placeholder = shortcuts[entry.action] ? t('pressKeysPlaceholder') : t('shortcutUnassigned');
      const conflicts = shortcutConflicts(shortcuts, entry.action, shortcuts[entry.action]);
      entry.input.setAttribute('aria-invalid', String(conflicts.length > 0));
      if (conflicts.length) entry.input.setAttribute('aria-describedby', notice.id);
      else entry.input.removeAttribute('aria-describedby');
      conflictsFound ||= conflicts.length > 0;
    }
    notice.textContent = conflictsFound ? t('shortcutExistingConflicts') : '';
    notice.hidden = !conflictsFound;
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
      await openDialog({ title: t('shortcutConflictTitle'), content: t('shortcutEscapeReserved'), actions: { type: 'acknowledge' } });
      return;
    }
    let confirmedOwners: Array<keyof Shortcuts> = [];
    for (;;) {
      const result = await update({ type: 'assign', action, shortcut, confirmedOwners });
      if (result.status === 'reserved') return;
      if (result.status === 'conflict') {
        const conflicts = result.owners;
        const names = conflicts.map(key => entries.find(entry => entry.action === key)?.label || key).join(', ');
        const target = entries.find(entry => entry.action === action)!.label;
        const confirmed = await openDialog({
          title: t('shortcutConflictTitle'),
          content: t('shortcutConflictDescription', [shortcut, names, target]),
          actions: { type: 'choice', falseLabel: t('shortcutKeepAssignment'), trueLabel: t('shortcutReassign'), initialFocus: 'cancel' }
        });
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
    grid?.setAttribute('aria-busy', 'true');
    try { await operation(); }
    catch (error) {
      console.error('Unable to save shortcuts:', error);
      await openDialog({ title: t('shortcutSaveError'), content: t('shortcutSaveErrorDescription'), actions: { type: 'acknowledge' } });
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
    render(defaultShortcuts);
    await refresh();
    for (const entry of entries) {
      entry.input.addEventListener('keydown', event => {
        if (event.key === 'Tab') return; // Recording must not trap keyboard navigation.
        event.preventDefault();
        event.stopPropagation();
        if (event.repeat || busy) return;
        const shortcut = shortcutFromEvent(event);
        if (!shortcut) return;
        entry.input.value = shortcut;
        void edit(entry.input, () => save(entry.action, shortcut));
      });
      entry.input.addEventListener('blur', () => { if (!busy) render(current); });
      entry.reset.addEventListener('click', () => void edit(entry.reset, () => save(entry.action, defaultShortcuts[entry.action])));
    }
    document.getElementById('reset-shortcuts-btn')?.addEventListener('click', event => {
      void edit(event.currentTarget as HTMLElement, async () => {
        await update({ type: 'resetAll' });
        noteCommitted({ ...defaultShortcuts });
        await onSaved();
      });
    });
    grid?.setAttribute('aria-busy', 'false');
  }
  return { initialize, refresh, applyStored };
}
