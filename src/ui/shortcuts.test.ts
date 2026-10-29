import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createShortcutEditor } from '../../options/shortcut-editor';

import { shortcutLabel } from './shortcut-display';
import { createShortcutUpdateQueue, readShortcutUpdate } from './shortcut-updates';
import { assignShortcut, defaultShortcuts, isNavigationShortcut, isReservedShortcut, loadKeyboardLayout, matchesShortcut, NAVIGATION_SHORTCUTS, resolveSeekHold, shortcutConflicts, shortcutsConflict, shortcutFromEvent, shortcutDisplayEnv, withShortcutDefaults } from './shortcuts';

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
  it('holds seek forward for 2x by default, adding no shortcut of its own', () => {
    assert.equal(resolveSeekHold(undefined), true);
    assert.equal(resolveSeekHold(false), false);
    assert.equal(resolveSeekHold('false'), true, 'only a saved boolean counts');
    // The hold rides on whatever Seek Forward is bound to, so conflicts follow that binding alone.
    const custom = withShortcutDefaults({ seekForward: 'Shift+J' });
    assert.deepEqual(shortcutConflicts(custom, 'toggle', 'Shift+J'), ['seekForward']);
    assert.deepEqual(shortcutConflicts(custom, 'toggle', 'ArrowRight'), []);
  });

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
    assert.equal(defaultShortcuts.toggleCaptions, 'C');
    assert.equal(defaultShortcuts.toggleChat, 'Alt+R');
    assert.equal(shortcutsConflict('C', 'Alt+R'), false);
    assert.equal(matchesShortcut(key({ key: 'r', code: 'KeyR' }), defaultShortcuts.toggleChat), false);
    assert.equal(matchesShortcut(key({ key: 'r', altKey: true, code: 'KeyR' }), defaultShortcuts.toggleChat), true);
    assert.equal(matchesShortcut(key({ key: 'c', shiftKey: true, code: 'KeyC' }), defaultShortcuts.toggleChat), false);
    assert.equal(withShortcutDefaults({ toggleCaptions: 'Alt+R' }).toggleChat, '');
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

  it('matches and records macOS Option letters by physical key, with exact modifiers', () => {
    const optionR = key({ key: '®', code: 'KeyR', altKey: true });
    assert.equal(matchesShortcut(optionR, 'Alt+R'), true);
    assert.equal(shortcutFromEvent(optionR), 'Alt+R');
    assert.equal(matchesShortcut(optionR, 'R'), false);
    assert.equal(matchesShortcut(optionR, 'Alt+T'), false);
    assert.equal(matchesShortcut(key({ key: '®', code: 'KeyR', altKey: true, shiftKey: true }), 'Alt+R'), false);
    assert.equal(matchesShortcut(key({ key: '®', code: 'KeyR' }), 'R'), false);
    assert.equal(matchesShortcut(key({ key: 'å', code: 'KeyA' }), 'A'), false);
    assert.equal(matchesShortcut(key({ key: 'r', code: 'KeyR', ctrlKey: true, altKey: true }), 'Alt+R'), false);
  });

  it('matches other macOS Option-produced characters by physical letter or digit', () => {
    for (const [produced, code, name] of [['å', 'KeyA', 'A'], ['∑', 'KeyW', 'W'], ['¡', 'Digit1', '1'], ['™', 'Digit2', '2']] as const) {
      const event = key({ key: produced, code, altKey: true });
      assert.equal(matchesShortcut(event, `Alt+${name}`), true, produced);
      assert.equal(shortcutFromEvent(event), `Alt+${name}`, produced);
      assert.equal(matchesShortcut(event, name), false, produced);
    }
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
  it('introduces audio shortcuts only where the keys are still free', () => {
    const migrated = withShortcutDefaults({ toggleMute: 'B', showHelp: 'Shift+V' });
    assert.equal(migrated.toggleMute, 'B');
    assert.equal(migrated.cycleBass, '');
    assert.equal(migrated.cycleVoice, 'V');
    assert.equal(migrated.cycleLeveling, 'R');
    assert.equal(migrated.toggleVolumeBoost, 'Shift+B');
    const defaults = Object.values(defaultShortcuts).filter(Boolean);
    assert.equal(defaults.every((left, index) => defaults.every((right, other) => other === index || !shortcutsConflict(left, right))), true);
  });
  it('introduces speed shortcuts on the shifted frame-step keys, never taking a custom binding', () => {
    const migrated = withShortcutDefaults({ toggleMute: '>' });
    assert.equal(migrated.decreaseSpeed, '<');
    assert.equal(migrated.increaseSpeed, '');
    assert.equal(shortcutsConflict(defaultShortcuts.decreaseSpeed, defaultShortcuts.frameBack), false);
    assert.equal(shortcutsConflict(defaultShortcuts.increaseSpeed, defaultShortcuts.frameForward), false);
    assert.equal(matchesShortcut(key({ key: '<', code: 'Comma', shiftKey: true }), defaultShortcuts.decreaseSpeed), true);
    assert.equal(matchesShortcut(key({ key: ',', code: 'Comma' }), defaultShortcuts.decreaseSpeed), false);
    assert.equal(matchesShortcut(key({ key: ',', code: 'Comma' }), defaultShortcuts.frameBack), true);
  });
  describe('moving frame step off the speed keys', () => {
    // Every save writes the whole map, so a map from before the speed shortcuts holds the old frame-step defaults.
    const before = Object.fromEntries(Object.entries({ ...defaultShortcuts, frameBack: '<', frameForward: '>' })
      .filter(([action]) => action !== 'decreaseSpeed' && action !== 'increaseSpeed'));
    const layout = (shortcuts: typeof defaultShortcuts) =>
      ({ frameBack: shortcuts.frameBack, frameForward: shortcuts.frameForward, decreaseSpeed: shortcuts.decreaseSpeed, increaseSpeed: shortcuts.increaseSpeed });

    it('moves the old defaults to the new layout', () => {
      assert.deepEqual(withShortcutDefaults(before), defaultShortcuts);
    });
    it('keeps frame-step keys the user chose', () => {
      assert.deepEqual(layout(withShortcutDefaults({ ...before, frameBack: 'J', frameForward: 'Shift+K' })),
        { frameBack: 'J', frameForward: 'Shift+K', decreaseSpeed: '<', increaseSpeed: '>' });
      assert.deepEqual(layout(withShortcutDefaults({ ...before, frameBack: '', frameForward: '' })),
        { frameBack: '', frameForward: '', decreaseSpeed: '<', increaseSpeed: '>' });
    });
    it('moves each key on its own when only one is still the old default or saved at all', () => {
      assert.deepEqual(layout(withShortcutDefaults({ ...before, frameForward: 'L' })),
        { frameBack: ',', frameForward: 'L', decreaseSpeed: '<', increaseSpeed: '>' });
      assert.deepEqual(layout(withShortcutDefaults({ frameBack: '<' })),
        { frameBack: ',', frameForward: '.', decreaseSpeed: '<', increaseSpeed: '>' });
      assert.deepEqual(layout(withShortcutDefaults({ toggle: 'T', exit: 'Escape' })),
        { frameBack: ',', frameForward: '.', decreaseSpeed: '<', increaseSpeed: '>' });
    });
    it('changes nothing once saved again, even a < chosen for frame step after the speed keys existed', () => {
      const migrated = withShortcutDefaults(before);
      assert.deepEqual(withShortcutDefaults({ ...migrated }), migrated);
      const chosen = assignShortcut(migrated, 'frameBack', '<');
      assert.deepEqual(layout(withShortcutDefaults({ ...chosen })),
        { frameBack: '<', frameForward: '.', decreaseSpeed: '', increaseSpeed: '>' });
    });
    it('never takes a key another action has', () => {
      // , and . belong to other actions: frame step keeps < and >, so the speed keys start unassigned.
      assert.deepEqual(layout(withShortcutDefaults({ ...before, toggleMute: ',', cycleFit: '.' })),
        { frameBack: '<', frameForward: '>', decreaseSpeed: '', increaseSpeed: '' });
      const kept = withShortcutDefaults({ ...before, toggleMute: '.' });
      assert.deepEqual(layout(kept), { frameBack: ',', frameForward: '>', decreaseSpeed: '<', increaseSpeed: '' });
      assert.equal(kept.toggleMute, '.');
      // Giving < and > to other actions cleared frame step: those actions keep them, and the speed keys yield.
      const taken = withShortcutDefaults({ ...before, frameBack: '', frameForward: '', toggleMute: '<', cycleFit: '>' });
      assert.deepEqual(layout(taken), { frameBack: '', frameForward: '', decreaseSpeed: '', increaseSpeed: '' });
      assert.deepEqual([taken.toggleMute, taken.cycleFit], ['<', '>']);
    });
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

describe('shortcut editor paint', () => {
  it('keeps a committed shortcut when blur and a stale storage read follow the save', async () => {
    const oldDocument = globalThis.document;
    const oldChrome = (globalThis as { chrome?: unknown }).chrome;
    let active: { id?: string } | null = null;
    const body = { id: 'body' };
    const grid = { setAttribute() {}, before() {} };
    const storage = { shortcuts: { ...defaultShortcuts } as Record<string, string> };
    let reads = 0;
    const held: { release: ((value: { shortcuts: Record<string, string> }) => void) | null } = { release: null };
    function field(id: string, action: string) {
      const inputListeners = new Map<string, Array<(event: Event) => void>>();
      const input = {
        id,
        value: '',
        placeholder: '',
        isConnected: true,
        listeners: inputListeners,
        setAttribute() {},
        removeAttribute() {},
        addEventListener(type: string, fn: (event: Event) => void) {
          const list = inputListeners.get(type) || [];
          list.push(fn);
          inputListeners.set(type, list);
        },
        dispatch(type: string, event: object) {
          for (const fn of inputListeners.get(type) || []) fn(event as Event);
        },
        focus() { active = input; },
        parentElement: {
          querySelector: () => ({
            dataset: { shortcut: action },
            setAttribute() {},
            addEventListener() {}
          })
        },
        closest: (selector: string) => (selector === '.options-body' ? grid : null)
      };
      return input;
    }
    const pin = field('shortcut-controls-pin', 'toggleControlsPin');
    const mute = field('shortcut-toggle-mute', 'toggleMute');
    const documentMock = {
      body,
      get activeElement() { return active; },
      querySelectorAll: () => [pin, mute],
      querySelector: (selector: string) => {
        const id = /for="([^"]+)"/.exec(selector)?.[1];
        return id ? { textContent: id } : null;
      },
      getElementById: () => null,
      createElement: () => ({
        id: '',
        className: '',
        hidden: false,
        style: {},
        textContent: '',
        setAttribute() {}
      })
    };
    globalThis.document = documentMock as unknown as Document;
    (globalThis as { chrome?: unknown }).chrome = {
      storage: {
        sync: {
          get: () => {
            reads += 1;
            if (reads === 1) return Promise.resolve({ shortcuts: { ...storage.shortcuts } });
            return new Promise<{ shortcuts: Record<string, string> }>((resolve) => { held.release = resolve; });
          }
        }
      },
      runtime: {
        sendMessage: async (message: { request: { action: keyof typeof defaultShortcuts; shortcut: string } }) => {
          storage.shortcuts = { ...storage.shortcuts, [message.request.action]: message.request.shortcut };
          return { status: 'saved' };
        }
      }
    };
    try {
      const editor = createShortcutEditor(async () => {});
      await editor.initialize();
      assert.equal(pin.value, 'Shift+H');
      pin.dispatch('keydown', {
        key: 'U',
        code: 'KeyU',
        shiftKey: true,
        ctrlKey: false,
        altKey: false,
        metaKey: false,
        repeat: false,
        isComposing: false,
        preventDefault() {},
        stopPropagation() {}
      });
      for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
      assert.equal(pin.value, 'Shift+U');
      pin.dispatch('blur', {});
      assert.equal(pin.value, 'Shift+U');
      if (!held.release) throw new Error('storage read did not start');
      active = mute;
      held.release({ shortcuts: { ...defaultShortcuts } });
      for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
      assert.equal(pin.value, 'Shift+U');
      assert.equal(active, mute);
      editor.applyStored({ ...storage.shortcuts, toggleMute: 'Ctrl+M' });
      assert.equal(pin.value, 'Shift+U');
      assert.equal(mute.value, 'Ctrl+M');
    } finally {
      globalThis.document = oldDocument;
      (globalThis as { chrome?: unknown }).chrome = oldChrome;
    }
  });

  it('does not throw for synthetic key events that lack key or code', () => {
    // Pages dispatch plain `Event('keydown')` objects; MAIN-world capture listeners match them.
    for (const event of [new Event('keydown'), { key: 'a' }, { code: 'KeyA' }, {}]) {
      assert.equal(matchesShortcut(event as KeyboardEvent, 'Ctrl+A'), false);
    }
  });
});

describe('frame step and speed keys across layouts', () => {
  // What each layout reports for the keys that print , . < > and for Shift with the keys that print , and .
  // (AZERTY prints . with Shift already).
  const layouts = {
    QWERTY: { ',': { key: ',', code: 'Comma' }, '.': { key: '.', code: 'Period' }, '<': { key: '<', code: 'Comma', shiftKey: true },
      '>': { key: '>', code: 'Period', shiftKey: true }, 'Shift+,': { key: '<', code: 'Comma', shiftKey: true }, 'Shift+.': { key: '>', code: 'Period', shiftKey: true } },
    QWERTZ: { ',': { key: ',', code: 'Comma' }, '.': { key: '.', code: 'Period' }, '<': { key: '<', code: 'IntlBackslash' },
      '>': { key: '>', code: 'IntlBackslash', shiftKey: true }, 'Shift+,': { key: ';', code: 'Comma', shiftKey: true }, 'Shift+.': { key: ':', code: 'Period', shiftKey: true } },
    AZERTY: { ',': { key: ',', code: 'KeyM' }, '.': { key: '.', code: 'Comma', shiftKey: true }, '<': { key: '<', code: 'IntlBackslash' },
      '>': { key: '>', code: 'IntlBackslash', shiftKey: true }, 'Shift+,': { key: '?', code: 'KeyM', shiftKey: true } },
    Dvorak: { ',': { key: ',', code: 'KeyW' }, '.': { key: '.', code: 'KeyE' }, '<': { key: '<', code: 'KeyW', shiftKey: true },
      '>': { key: '>', code: 'KeyE', shiftKey: true }, 'Shift+,': { key: '<', code: 'KeyW', shiftKey: true }, 'Shift+.': { key: '>', code: 'KeyE', shiftKey: true } }
  };
  const owners = (event: Parameters<typeof key>[0] | undefined) => !event ? [] : (Object.keys(defaultShortcuts) as Array<keyof typeof defaultShortcuts>)
    .filter(action => matchesShortcut(key(event), defaultShortcuts[action]));

  for (const [name, events] of Object.entries(layouts) as Array<[string, Record<string, Parameters<typeof key>[0] | undefined>]>) {
    it(`gives each key one action on ${name}`, () => {
      // On Dvorak , prints on the W position, which Navigate up claims by position (and handles first).
      assert.deepEqual(owners(events[',']), name === 'Dvorak' ? ['frameBack', 'navigateUp'] : ['frameBack']);
      assert.deepEqual(owners(events['.']), ['frameForward']);
      assert.deepEqual(owners(events['<']), ['decreaseSpeed']);
      assert.deepEqual(owners(events['>']), ['increaseSpeed']);
      // Shift with those keys prints something else, so it never steps a frame.
      assert.equal(owners(events['Shift+,']).includes('frameBack'), false);
      assert.equal(owners(events['Shift+.']).includes('frameForward'), false);
    });
  }
  it('records punctuation without the Shift the layout needed for it', () => {
    assert.equal(shortcutFromEvent(key(layouts.AZERTY['.'])), '.');
    assert.equal(shortcutFromEvent(key(layouts.QWERTZ['>'])), '>');
    assert.equal(shortcutFromEvent(key({ key: 'K', code: 'KeyK', shiftKey: true })), 'Shift+K');
    assert.equal(shortcutFromEvent(key({ key: '1', code: 'Numpad1', shiftKey: true })), 'Shift+1');
  });
});

describe('navigation shortcuts', () => {
  const [up, left, down, right] = NAVIGATION_SHORTCUTS;
  // What each layout prints on a position: AZERTY puts Z, Q, S, D on the W, A, S, D positions and W on Z.
  const azerty = { w: key({ key: 'z', code: 'KeyW' }), a: key({ key: 'q', code: 'KeyA' }), s: key({ key: 's', code: 'KeyS' }), d: key({ key: 'd', code: 'KeyD' }) };

  it('is one group of four position keys, W A S D by default', () => {
    assert.deepEqual(NAVIGATION_SHORTCUTS.map(name => defaultShortcuts[name]), ['KeyW', 'KeyA', 'KeyS', 'KeyD']);
    assert.equal(NAVIGATION_SHORTCUTS.every(isNavigationShortcut), true);
    assert.equal(isNavigationShortcut('cycleBass'), false);
  });

  it('matches by position, so the cluster follows the keyboard layout', () => {
    for (const [action, event] of [[up, azerty.w], [left, azerty.a], [down, azerty.s], [right, azerty.d]] as const) {
      assert.equal(matchesShortcut(event, defaultShortcuts[action]), true, `${action} on AZERTY`);
    }
    // QWERTZ swaps only Y and Z: the printed Z/Y sit elsewhere and are not navigation.
    assert.equal(matchesShortcut(key({ key: 'z', code: 'KeyY' }), defaultShortcuts[up]), false);
    assert.equal(matchesShortcut(key({ key: 'y', code: 'KeyZ' }), defaultShortcuts[up]), false);
    assert.equal(matchesShortcut(key({ key: 'w', code: 'KeyW' }), defaultShortcuts[up]), true);
    // The AZERTY Z position prints W but is not the W position.
    assert.equal(matchesShortcut(key({ key: 'w', code: 'KeyZ' }), defaultShortcuts[up]), false);
  });

  it('requires exactly the bare key', () => {
    for (const modifier of ['shiftKey', 'altKey', 'ctrlKey', 'metaKey']) {
      assert.equal(matchesShortcut(key({ key: 'w', code: 'KeyW', [modifier]: true }), defaultShortcuts[up]), false, modifier);
    }
  });

  it('is added to older settings without taking a key the user already uses', () => {
    const migrated = withShortcutDefaults({ toggleMute: 'A', cycle: 'Shift+W' });
    assert.equal(migrated.navigateLeft, '');
    assert.equal(migrated.navigateUp, 'KeyW');
    assert.equal(migrated.navigateDown, 'KeyS');
    assert.equal(withShortcutDefaults({ navigateLeft: 'KeyJ' }).navigateLeft, 'KeyJ');
    assert.equal(withShortcutDefaults({ navigateLeft: '' }).navigateLeft, '');
  });

  it('conflicts with a letter bound by name or by position, in either spelling', () => {
    assert.equal(shortcutsConflict('KeyW', 'W'), true);
    assert.equal(shortcutsConflict('KeyW', 'KeyW'), true);
    assert.equal(shortcutsConflict('KeyW', 'Shift+W'), false);
    assert.equal(shortcutsConflict('KeyW', 'KeyA'), false);
    assert.deepEqual(shortcutConflicts(defaultShortcuts, 'toggleMute', 'S'), [down]);
    assert.deepEqual(assignShortcut(defaultShortcuts, 'toggleMute', 'D').navigateRight, '');
    // The defaults collide with nothing else.
    for (const action of NAVIGATION_SHORTCUTS) assert.deepEqual(shortcutConflicts(defaultShortcuts, action, defaultShortcuts[action]), []);
    assert.equal(left, 'navigateLeft');
  });

  it('records the group by position and every other action by what the key prints', () => {
    const event = { ...azerty.w, isComposing: false } as KeyboardEvent;
    assert.equal(shortcutFromEvent(event, true), 'KeyW');
    assert.equal(shortcutFromEvent(event), 'Z');
    assert.equal(shortcutFromEvent({ ...key({ key: 'W', code: 'KeyW', shiftKey: true }), isComposing: false } as KeyboardEvent, true), 'Shift+KeyW');
    assert.equal(shortcutFromEvent({ ...key({ key: 'ArrowUp', code: 'ArrowUp' }), isComposing: false } as KeyboardEvent, true), 'ArrowUp');
    assert.equal(shortcutFromEvent({ ...azerty.w, isComposing: true } as KeyboardEvent, true), '');
  });

  it('shows what the layout prints where it can say, and the default letter where it cannot', async () => {
    const shown = (stored: string) => shortcutLabel(stored, shortcutDisplayEnv());
    assert.equal(shown('KeyW'), 'W');
    assert.equal(shown('T'), 'T');
    const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { platform: 'Win32', keyboard: { getLayoutMap: async () => new Map([['KeyW', 'z'], ['KeyA', 'q']]) } } });
    try {
      await loadKeyboardLayout();
      assert.equal(shown('KeyW'), 'Z');
      assert.equal(shown('KeyA'), 'Q');
      assert.equal(shown('KeyS'), 'S');
      Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { keyboard: { getLayoutMap: async () => { throw new Error('blocked'); } } } });
      await loadKeyboardLayout();
      assert.equal(shown('KeyW'), 'W');
    } finally {
      if (original) Object.defineProperty(globalThis, 'navigator', original);
      await loadKeyboardLayout();
    }
  });
});

describe('letter shortcuts on non-Latin layouts', () => {
  const press = (keyName: string, code: string, extra: { ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean } = {}) =>
    ({ ...key({ key: keyName, code, ...extra }), isComposing: false }) as KeyboardEvent;

  it('fires a letter shortcut by position when the layout prints a non-Latin letter', () => {
    const cases: Array<[string, string, string, boolean]> = [
      ['M', 'ь', 'KeyM', true], // Cyrillic
      ['W', 'ц', 'KeyW', true],
      ['M', 'μ', 'KeyM', true], // Greek
      ['T', 'τ', 'KeyT', true],
      ['T', 'א', 'KeyT', true], // Hebrew
      ['M', 'ь', 'KeyN', false], // another position
      ['Y', 'н', 'KeyN', false] // the printed letter's QWERTY twin must not match: position decides
    ];
    for (const [shortcut, printed, code, expected] of cases) {
      assert.equal(matchesShortcut(key({ key: printed, code }), shortcut), expected, `${shortcut} vs ${printed}/${code}`);
    }
  });

  it('keeps modifiers exact on a non-Latin layout', () => {
    assert.equal(matchesShortcut(key({ key: 'Ь', code: 'KeyM', shiftKey: true }), 'Shift+M'), true);
    assert.equal(matchesShortcut(key({ key: 'ь', code: 'KeyM', ctrlKey: true }), 'Ctrl+M'), true);
    assert.equal(matchesShortcut(key({ key: 'ь', code: 'KeyM', ctrlKey: true }), 'M'), false);
    assert.equal(matchesShortcut(key({ key: 'Ь', code: 'KeyM', shiftKey: true }), 'M'), false);
    assert.equal(matchesShortcut(key({ key: 'ь', code: 'KeyM', altKey: true }), 'Alt+M'), true);
  });

  it('lets the printed Latin letter win over the position on other layouts', () => {
    assert.equal(matchesShortcut(key({ key: 'z', code: 'KeyW' }), 'Z'), true); // AZERTY
    assert.equal(matchesShortcut(key({ key: 'z', code: 'KeyW' }), 'W'), false);
    assert.equal(matchesShortcut(key({ key: 'z', code: 'KeyY' }), 'Z'), true); // QWERTZ
    assert.equal(matchesShortcut(key({ key: 'z', code: 'KeyY' }), 'Y'), false);
    assert.equal(matchesShortcut(key({ key: 'y', code: 'KeyT' }), 'T'), false); // Dvorak
    assert.equal(matchesShortcut(key({ key: 'y', code: 'KeyT' }), 'Y'), true);
    assert.equal(matchesShortcut(key({ key: ',', code: 'KeyW' }), 'W'), false); // Dvorak punctuation at KeyW
    assert.equal(matchesShortcut(key({ key: 'm', code: 'KeyM', ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+M'), true);
  });

  it('leaves punctuation and position-stored shortcuts alone', () => {
    assert.equal(matchesShortcut(key({ key: '<', code: 'Comma', shiftKey: true }), '<'), true);
    assert.equal(matchesShortcut(key({ key: 'ь', code: 'KeyM' }), '<'), false);
    assert.equal(matchesShortcut(key({ key: 'ц', code: 'KeyW' }), defaultShortcuts.navigateUp), true);
    assert.equal(matchesShortcut(key({ key: 'ц', code: 'KeyW' }), defaultShortcuts.navigateDown), false);
    // A binding recorded earlier on a Cyrillic layout keeps working there.
    assert.equal(matchesShortcut(key({ key: 'ь', code: 'KeyM' }), 'Ь'), true);
  });

  it('ignores events that lack key or code', () => {
    for (const event of [{ key: 'ь' }, { code: 'KeyM' }, { key: 'ь', code: undefined }, {}]) {
      assert.equal(matchesShortcut(event as unknown as KeyboardEvent, 'M'), false);
    }
  });

  it('records the Latin letter of the position, so the binding is portable', () => {
    assert.equal(shortcutFromEvent(press('ь', 'KeyM')), 'M');
    assert.equal(shortcutFromEvent(press('Ц', 'KeyW', { shiftKey: true })), 'Shift+W');
    assert.equal(shortcutFromEvent(press('μ', 'KeyM', { ctrlKey: true })), 'Ctrl+M');
    assert.equal(shortcutFromEvent(press('א', 'KeyT')), 'T');
    assert.equal(shortcutFromEvent(press('z', 'KeyW')), 'Z'); // AZERTY still records the printed letter
    assert.equal(shortcutFromEvent(press('ь', 'KeyM'), true), 'KeyM');
    assert.equal(shortcutFromEvent(press('ь', 'Comma')), 'Ь'); // not a letter position: unchanged
  });

  it('detects a conflict between a recorded Cyrillic letter and the Latin default on that position', () => {
    const recorded = shortcutFromEvent(press('ь', 'KeyM'));
    assert.equal(shortcutsConflict(recorded, defaultShortcuts.toggleMute), true);
    assert.deepEqual(shortcutConflicts(defaultShortcuts, 'togglePiP', recorded), ['toggleMute']);
    assert.equal(shortcutsConflict(recorded, 'KeyM'), true);
    assert.equal(shortcutsConflict(recorded, 'N'), false);
  });
});
