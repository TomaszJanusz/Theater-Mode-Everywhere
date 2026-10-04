import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createShortcutUpdateQueue, readShortcutUpdate } from './shortcut-updates';
import { assignShortcut, defaultShortcuts, isReservedShortcut, matchesShortcut, shortcutConflicts, shortcutsConflict, shortcutFromEvent, shortcutDisplayParts, withShortcutDefaults } from './shortcuts';

function key(partial: {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
}): KeyboardEvent {
  return {
    key: partial.key,
    code: partial.code || '',
    ctrlKey: Boolean(partial.ctrlKey),
    altKey: Boolean(partial.altKey),
    shiftKey: Boolean(partial.shiftKey),
    metaKey: Boolean(partial.metaKey)
  } as KeyboardEvent;
}

describe('shortcut matching', () => {
  it('adds the pin shortcut to older settings without conflicting with help or losing custom keys', () => {
    const oldSettings = withShortcutDefaults({ showHelp: 'H', toggle: 'Ctrl+T' });
    assert.equal(oldSettings.toggleControlsPin, 'Shift+H');
    assert.equal(oldSettings.cycleLayout, 'Shift+L');
    assert.equal(oldSettings.toggle, 'Ctrl+T');
    const pin = key({ key: 'H', code: 'KeyH', shiftKey: true });
    assert.equal(matchesShortcut(pin, oldSettings.toggleControlsPin), true);
    assert.equal(matchesShortcut(pin, oldSettings.showHelp), false);
    const custom = withShortcutDefaults({ ...oldSettings, toggleControlsPin: 'Shift+U' });
    assert.equal(withShortcutDefaults({ ...custom, toggleMute: 'Ctrl+M' }).toggleControlsPin, 'Shift+U');
  });

  it('defaults mute to M', () => {
    assert.equal(defaultShortcuts.previousVideo, 'Shift+P');
    assert.equal(defaultShortcuts.nextVideo, 'Shift+N');
    assert.equal(matchesShortcut(key({ key: 'P', shiftKey: true, code: 'KeyP' }), 'Shift+P'), true);
    assert.equal(matchesShortcut(key({ key: 'P', code: 'KeyP' }), 'Shift+P'), false);
    assert.equal(matchesShortcut(key({ key: 'N', shiftKey: true, code: 'KeyN' }), 'Shift+N'), true);
    assert.equal(defaultShortcuts.toggleMute, 'M');
    assert.equal(defaultShortcuts.increaseCaptionSize, '+');
    assert.equal(defaultShortcuts.decreaseCaptionSize, '-');
  });

  it('matches a standalone plus key', () => {
    assert.equal(matchesShortcut(key({ key: '+', shiftKey: true, code: 'Equal' }), '+'), true);
  });

  it('matches compatible equal, Shift+=, and numpad plus events', () => {
    assert.equal(matchesShortcut(key({ key: '=', shiftKey: true, code: 'Equal' }), '+'), true);
    assert.equal(matchesShortcut(key({ key: '+', code: 'NumpadAdd' }), '+'), true);
    assert.equal(matchesShortcut(key({ key: '=', code: 'Equal' }), '+'), true);
  });

  it('matches Ctrl++ without dropping the plus', () => {
    assert.equal(
      matchesShortcut(key({ key: '+', ctrlKey: true, shiftKey: true, code: 'Equal' }), 'Ctrl++'),
      true
    );
  });

  it('still matches Shift+T', () => {
    assert.equal(matchesShortcut(key({ key: 't', shiftKey: true, code: 'KeyT' }), 'Shift+T'), true);
  });

  it('renders + and Ctrl++ as real keys instead of empty kbd parts', () => {
    assert.deepEqual(shortcutDisplayParts('+'), ['+']);
    assert.deepEqual(shortcutDisplayParts('Ctrl++'), ['Ctrl', '+']);
    assert.deepEqual(shortcutDisplayParts('Shift+T'), ['Shift', 'T']);
  });
});

describe('shortcut ownership', () => {
  it('introduces Layout without taking Shift+L from an existing custom binding', () => {
    const migrated = withShortcutDefaults({ showHelp: 'Shift+L' });
    assert.equal(migrated.showHelp, 'Shift+L');
    assert.equal(migrated.cycleLayout, '');
    assert.deepEqual(shortcutConflicts(migrated, 'cycleLayout', 'Shift+L'), ['showHelp']);
    const explicit = withShortcutDefaults({ showHelp: 'Shift+L', cycleLayout: 'Shift+L' });
    assert.equal(explicit.cycleLayout, 'Shift+L'); // Existing explicit duplicates remain visible for user resolution.
  });
  it('detects runtime aliases and implicit Shift without merging distinct modifiers', () => {
    for (const [a, b] of [['f', 'F'], ['F', 'KeyF'], ['+', '='], ['+', 'Shift+='], ['Ctrl++', 'Ctrl+Equal'], ['<', 'Shift+Comma'], ['Space', 'Spacebar']]) {
      assert.equal(shortcutsConflict(a, b), true, `${a} / ${b}`);
      assert.equal(shortcutsConflict(b, a), true);
    }
    for (const [a, b] of [['F', 'Shift+F'], ['Ctrl+F', 'F'], ['Alt+F', 'Meta+F'], ['+', 'Ctrl++'], ['', 'T']]) {
      assert.equal(shortcutsConflict(a, b), false, `${a} / ${b}`);
    }
    for (const action of Object.keys(defaultShortcuts) as Array<keyof typeof defaultShortcuts>) {
      assert.deepEqual(shortcutConflicts(defaultShortcuts, action, defaultShortcuts[action]), []);
    }
  });
  it('records plus and shifted punctuation exactly as the runtime expects', () => {
    assert.equal(shortcutFromEvent(key({ key: '+', shiftKey: true, ctrlKey: true })), 'Ctrl++');
    assert.equal(shortcutFromEvent(key({ key: '<', shiftKey: true })), '<');
    assert.equal(shortcutFromEvent(key({ key: 'f', shiftKey: true })), 'Shift+F');
    assert.equal(shortcutFromEvent(key({ key: ' ' })), 'Space');
    assert.equal(shortcutFromEvent(key({ key: 'Shift', shiftKey: true })), '');
    assert.equal(shortcutFromEvent(key({ key: 'AltGraph', ctrlKey: true, altKey: true })), '');
    assert.equal(shortcutFromEvent({ ...key({ key: 'f' }), isComposing: true } as KeyboardEvent), '');
  });
  it('reassigns all previous owners and preserves disabled shortcuts on reload', () => {
    const previous = { ...defaultShortcuts, toggleMute: 'F' };
    const next = assignShortcut(previous, 'toggle', 'F');
    assert.equal(next.toggle, 'F');
    assert.equal(next.toggleFullscreen, '');
    assert.equal(next.toggleMute, '');
    assert.equal(next.showHelp, 'H');
    assert.equal(previous.toggleFullscreen, 'F');
    assert.equal(withShortcutDefaults({ ...next }).toggleFullscreen, '');
    assert.equal(withShortcutDefaults({ toggleFullscreen: null }).toggleFullscreen, 'F');
    assert.equal(isReservedShortcut('toggle', 'Escape'), true);
    assert.equal(isReservedShortcut('exit', 'Escape'), false);
  });
});

describe('serialized shortcut updates', () => {
  function fixture() {
    let saved = { ...defaultShortcuts };
    let writes = 0;
    let failNext = false;
    const queue = createShortcutUpdateQueue({
      read: async () => ({ ...saved }),
      write: async value => {
        await Promise.resolve();
        if (failNext) { failNext = false; throw new Error('storage unavailable'); }
        saved = value; writes++;
      }
    });
    return { ...queue, saved: () => saved, writes: () => writes, fail: () => { failNext = true; } };
  }
  it('leaves storage unchanged until a transfer is confirmed, then saves both actions together', async () => {
    const f = fixture();
    const request = { type: 'assign' as const, action: 'toggle' as const, shortcut: 'F', confirmedOwners: [] };
    assert.deepEqual(await f.apply(request), { status: 'conflict', owners: ['toggleFullscreen'] });
    assert.equal(f.writes(), 0);
    assert.deepEqual(await f.apply({ ...request, confirmedOwners: ['toggleFullscreen'] }), { status: 'saved' });
    assert.equal(f.saved().toggle, 'F');
    assert.equal(f.saved().toggleFullscreen, '');
    assert.equal(f.writes(), 1);
  });
  it('revalidates ownership when a dialog is answered after another tab changes it', async () => {
    const f = fixture();
    await f.apply({ type: 'assign', action: 'showHelp', shortcut: 'F', confirmedOwners: ['toggleFullscreen'] });
    assert.deepEqual(await f.apply({ type: 'assign', action: 'toggle', shortcut: 'F', confirmedOwners: ['toggleFullscreen'] }), { status: 'conflict', owners: ['showHelp'] });
    assert.equal(f.saved().toggle, 'T');
  });
  it('preserves simultaneous edits in separate tabs and refuses a new concurrent conflict', async () => {
    const f = fixture();
    const results = await Promise.all([
      f.apply({ type: 'assign', action: 'toggle', shortcut: 'U', confirmedOwners: [] }),
      f.apply({ type: 'assign', action: 'showHelp', shortcut: 'I', confirmedOwners: [] }),
      f.apply({ type: 'assign', action: 'toggleMute', shortcut: 'U', confirmedOwners: [] })
    ]);
    assert.deepEqual(results, [{ status: 'saved' }, { status: 'saved' }, { status: 'conflict', owners: ['toggle'] }]);
    assert.equal(f.saved().toggle, 'U');
    assert.equal(f.saved().showHelp, 'I');
    assert.equal(f.saved().toggleMute, 'M');
  });
  it('recovers after a failed write and serializes reset with later edits', async () => {
    const f = fixture();
    f.fail();
    await assert.rejects(f.apply({ type: 'resetAll' }));
    await Promise.all([
      f.apply({ type: 'resetAll' }),
      f.apply({ type: 'assign', action: 'toggle', shortcut: 'U', confirmedOwners: [] })
    ]);
    assert.equal(f.saved().toggle, 'U');
    assert.equal(f.writes(), 2);
    assert.deepEqual(await f.apply({ type: 'assign', action: 'toggle', shortcut: 'Escape', confirmedOwners: [] }), { status: 'reserved' });
    assert.equal(f.writes(), 2);
  });
  it('rejects malformed messages and accepts explicit unbinding', () => {
    assert.equal(readShortcutUpdate({ type: 'assign', action: 'constructor', shortcut: 'F', confirmedOwners: [] }), null);
    assert.equal(readShortcutUpdate({ type: 'assign', action: 'toggle', shortcut: 'F', confirmedOwners: ['bogus'] }), null);
    const request = { type: 'assign', action: 'toggle', shortcut: '', confirmedOwners: [] };
    assert.deepEqual(readShortcutUpdate(request), request);
  });
});
