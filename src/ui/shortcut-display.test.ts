import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { detectShortcutPlatform, parseShortcut, shortcutKeyHint, shortcutLabel, shortcutMarkup, shortcutTokens, type ShortcutDisplayEnv, type ShortcutPlatform } from './shortcut-display';
import { defaultShortcuts, withShortcutDefaults } from './shortcuts';

const windows: ShortcutDisplayEnv = { platform: 'windows' };
const linux: ShortcutDisplayEnv = { platform: 'other' };
const mac: ShortcutDisplayEnv = { platform: 'mac' };
const azerty: ShortcutDisplayEnv = { platform: 'windows', layout: new Map([['KeyW', 'z'], ['KeyA', 'q'], ['Digit1', '&']]) };
const cyrillic: ShortcutDisplayEnv = { platform: 'other', layout: new Map([['KeyW', 'ц'], ['KeyA', 'ф']]) };

describe('shortcut display', () => {
  it('splits stored shortcuts with the main key last, including the plus key', () => {
    assert.deepEqual(parseShortcut(''), { modifiers: [], key: '' });
    assert.deepEqual(parseShortcut('+'), { modifiers: [], key: '+' });
    assert.deepEqual(parseShortcut('Ctrl++'), { modifiers: ['Ctrl'], key: '+' });
    assert.deepEqual(parseShortcut('Ctrl+Alt+Shift+Meta+K'), { modifiers: ['Ctrl', 'Alt', 'Shift', 'Meta'], key: 'K' });
  });

  // Stored value -> plain label per platform: Windows, Linux, macOS.
  const labels: ReadonlyArray<readonly [string, string, string, string]> = [
    ['T', 'T', 'T', 'T'],
    ['Shift+T', 'Shift+T', 'Shift+T', '⇧T'],
    ['Ctrl+Shift+K', 'Ctrl+Shift+K', 'Ctrl+Shift+K', '⌃⇧K'],
    ['Ctrl+Alt+Shift+Meta+K', 'Ctrl+Alt+Shift+Win+K', 'Ctrl+Alt+Shift+Super+K', '⌃⌥⇧⌘K'],
    ['Alt+R', 'Alt+R', 'Alt+R', '⌥R'],
    ['Meta+K', 'Win+K', 'Super+K', '⌘K'],
    ['ArrowLeft', '←', '←', '←'],
    ['ArrowRight', '→', '→', '→'],
    ['ArrowUp', '↑', '↑', '↑'],
    ['Shift+ArrowDown', 'Shift+↓', 'Shift+↓', '⇧↓'],
    ['Space', 'Space', 'Space', 'Space'],
    ['Escape', 'Esc', 'Esc', 'Esc'],
    ['Enter', 'Enter', 'Enter', 'Enter'],
    ['Tab', 'Tab', 'Tab', 'Tab'],
    ['Backspace', 'Backspace', 'Backspace', 'Backspace'],
    ['Delete', 'Del', 'Del', 'Del'],
    ['Insert', 'Ins', 'Ins', 'Ins'],
    ['PageUp', 'Page Up', 'Page Up', 'Page Up'],
    ['Ctrl+Alt+Shift+PageDown', 'Ctrl+Alt+Shift+Page Down', 'Ctrl+Alt+Shift+Page Down', '⌃⌥⇧Page Down'],
    ['Home', 'Home', 'Home', 'Home'],
    ['End', 'End', 'End', 'End'],
    ['F5', 'F5', 'F5', 'F5'],
    ['F12', 'F12', 'F12', 'F12'],
    ['Numpad1', 'Num 1', 'Num 1', 'Num 1'],
    ['KeyW', 'W', 'W', 'W'],
    ['Shift+KeyS', 'Shift+S', 'Shift+S', '⇧S'],
    ['Digit1', '1', '1', '1'],
    ['+', '+', '+', '+'],
    ['Ctrl++', 'Ctrl++', 'Ctrl++', '⌃+'],
    ['Ctrl+-', 'Ctrl+-', 'Ctrl+-', '⌃-'],
    ['<', '<', '<', '<'],
    ['Ц', 'Ц', 'Ц', 'Ц'],
    ['MediaPlayPause', 'MediaPlayPause', 'MediaPlayPause', 'MediaPlayPause'],
    ['', '', '', '']
  ];
  for (const [stored, onWindows, onLinux, onMac] of labels) {
    it(`labels ${JSON.stringify(stored)} per platform`, () => {
      assert.equal(shortcutLabel(stored, windows), onWindows);
      assert.equal(shortcutLabel(stored, linux), onLinux);
      assert.equal(shortcutLabel(stored, mac), onMac);
    });
  }

  it('gives every cap its own token, modifiers first', () => {
    assert.deepEqual(shortcutTokens('Ctrl+Shift+K', windows), [
      { text: 'Ctrl', label: 'Ctrl', kind: 'modifier' },
      { text: 'Shift', label: 'Shift', kind: 'modifier' },
      { text: 'K', label: 'K', kind: 'key' }
    ]);
    assert.deepEqual(shortcutTokens('', windows), []);
    assert.equal(shortcutTokens('Ctrl++', windows).length, 2);
  });

  it('names glyph and abbreviated caps in words', () => {
    const spoken = (stored: string, env: ShortcutDisplayEnv) => shortcutTokens(stored, env).map(({ label }) => label);
    assert.deepEqual(spoken('Ctrl+Alt+Shift+Meta+ArrowLeft', mac), ['Control', 'Option', 'Shift', 'Command', 'Left arrow']);
    assert.deepEqual(spoken('Meta++', windows), ['Windows', 'Plus']);
    assert.deepEqual(spoken('Escape', linux), ['Escape']);
    assert.deepEqual(spoken('Delete', linux), ['Delete']);
    assert.deepEqual(spoken('Space', linux), ['Space']);
  });

  it('hints a single glyph, arrows included, and never a word or a chord', () => {
    assert.equal(shortcutKeyHint('A', windows), 'A');
    assert.equal(shortcutKeyHint('KeyW', azerty), 'Z');
    assert.equal(shortcutKeyHint('ArrowLeft', windows), '←');
    assert.equal(shortcutKeyHint('ArrowRight', mac), '→');
    assert.equal(shortcutKeyHint('Space', windows), undefined);
    assert.equal(shortcutKeyHint('Shift+A', windows), undefined);
    assert.equal(shortcutKeyHint('', windows), undefined);
  });

  it('localizes spoken names only, never the visible legend', () => {
    const czech: ShortcutDisplayEnv = { platform: 'mac', spoken: message => ({ keyLabelArrowLeft: 'Šipka vlevo', keyLabelCommand: 'Command' } as Record<string, string>)[message] };
    assert.deepEqual(shortcutTokens('Meta+ArrowLeft', czech), [
      { text: '⌘', label: 'Command', kind: 'modifier' },
      { text: '←', label: 'Šipka vlevo', kind: 'key' }
    ]);
    // A missing translation falls back to English rather than a message key.
    assert.equal(shortcutTokens('ArrowRight', czech)[0].label, 'Right arrow');
    const asked: string[] = [];
    shortcutTokens('Ctrl+Shift+Space', { platform: 'windows', spoken: message => { asked.push(message); return 'x'; } });
    assert.deepEqual(asked, []);
  });

  it('shows physical positions by what the layout prints, and the QWERTY legend without a map', () => {
    assert.equal(shortcutLabel('KeyW', azerty), 'Z');
    assert.equal(shortcutLabel('KeyA', azerty), 'Q');
    assert.equal(shortcutLabel('KeyS', azerty), 'S');
    assert.equal(shortcutLabel('Digit1', azerty), '&');
    assert.equal(shortcutLabel('KeyW', cyrillic), 'Ц');
    assert.equal(shortcutLabel('Shift+KeyA', cyrillic), 'Shift+Ф');
    // Characters (not positions) are what was typed; the layout does not relabel them.
    assert.equal(shortcutLabel('W', azerty), 'W');
  });

  it('marks up one tooltip cap per key, keeping the plus key whole', () => {
    assert.equal(shortcutMarkup('Ctrl++', windows), '<kbd>Ctrl</kbd>+<kbd>+</kbd>');
    assert.equal(shortcutMarkup('Shift+P', windows), '<kbd>Shift</kbd>+<kbd>P</kbd>');
    assert.equal(shortcutMarkup('Ctrl++', mac), '<kbd>⌃</kbd><kbd>+</kbd>');
    assert.equal(shortcutMarkup('Escape', linux), '<kbd>Esc</kbd>');
    assert.equal(shortcutMarkup('', linux), '');
  });

  it('keeps a letter whose capital is longer as typed', () => {
    assert.equal(shortcutLabel('ß', windows), 'ß');
  });

  it('resolves the platform from userAgentData before navigator.platform', () => {
    const cases: ReadonlyArray<readonly [Parameters<typeof detectShortcutPlatform>[0], ShortcutPlatform]> = [
      [{ platform: 'MacIntel' }, 'mac'],
      [{ platform: 'iPad' }, 'mac'],
      [{ platform: 'Win32' }, 'windows'],
      [{ platform: 'Linux x86_64' }, 'other'],
      [{ platform: '' }, 'other'],
      [{ platform: 'Darwin' }, 'other'],
      [{ platform: 'Linux x86_64', userAgentData: { platform: 'macOS' } }, 'mac'],
      [{ platform: 'MacIntel', userAgentData: { platform: 'Windows' } }, 'windows'],
      [{ platform: 'Win32', userAgentData: { platform: 'Chrome OS' } }, 'other']
    ];
    for (const [nav, expected] of cases) assert.equal(detectShortcutPlatform(nav), expected, JSON.stringify(nav));
  });

  it('leaves the stored format alone', () => {
    const saved = { ...defaultShortcuts, toggle: 'Ctrl+Shift+K', seekBack: 'Shift+ArrowLeft', increaseCaptionSize: 'Ctrl++', navigateUp: 'KeyW' };
    assert.deepEqual(withShortcutDefaults(saved), saved);
  });
});
