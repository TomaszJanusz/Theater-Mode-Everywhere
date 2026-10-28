import type { AudioSettingName } from '../audio-settings';

import { detectShortcutPlatform, type ShortcutDisplayEnv, type ShortcutPlatform } from './shortcut-display';

export interface Shortcuts {
  toggle: string;
  exit: string;
  seekBack: string;
  seekForward: string;
  cycle: string;
  playPause: string;
  previousVideo: string;
  nextVideo: string;
  frameBack: string;
  frameForward: string;
  decreaseSpeed: string;
  increaseSpeed: string;
  toggleFullscreen: string;
  volumeUp: string;
  volumeDown: string;
  toggleMute: string;
  togglePiP: string;
  showHelp: string;
  toggleControlsPin: string;
  cycleFit: string;
  cycleLayout: string;
  toggleChat: string;
  toggleCaptions: string;
  increaseCaptionSize: string;
  decreaseCaptionSize: string;
  toggleVolumeBoost: string;
  cycleVoice: string;
  cycleLeveling: string;
  cycleBass: string;
  navigateUp: string;
  navigateLeft: string;
  navigateDown: string;
  navigateRight: string;
}

/**
 * The Navigation group: one cluster of four keys that move focus around the controls bar and its menus.
 * Their defaults are physical keys (`KeyW`...), so the cluster sits in the same place on QWERTY, QWERTZ and AZERTY.
 */
export const NAVIGATION_SHORTCUTS = ['navigateUp', 'navigateLeft', 'navigateDown', 'navigateRight'] as const satisfies ReadonlyArray<keyof Shortcuts>;
export type NavigationShortcut = (typeof NAVIGATION_SHORTCUTS)[number];
export const NAVIGATION_DIRECTIONS = { navigateUp: 'up', navigateLeft: 'left', navigateDown: 'down', navigateRight: 'right' } as const satisfies Record<NavigationShortcut, string>;
export type NavigationDirection = (typeof NAVIGATION_DIRECTIONS)[NavigationShortcut];

export function isNavigationShortcut(action: keyof Shortcuts): action is NavigationShortcut {
  return (NAVIGATION_SHORTCUTS as readonly string[]).includes(action);
}

export const AUDIO_SHORTCUTS = {
  voice: 'cycleVoice',
  leveling: 'cycleLeveling',
  bass: 'cycleBass'
} as const satisfies Record<AudioSettingName, keyof Shortcuts>;

export const defaultShortcuts: Shortcuts = {
  toggle: 'T',
  exit: 'Escape',
  seekBack: 'ArrowLeft',
  seekForward: 'ArrowRight',
  cycle: 'Shift+T',
  playPause: 'Space',
  previousVideo: 'Shift+P',
  nextVideo: 'Shift+N',
  // As on YouTube: , and . step frames, < and > (Shift+, and Shift+.) change the speed.
  frameBack: ',',
  frameForward: '.',
  decreaseSpeed: '<',
  increaseSpeed: '>',
  toggleFullscreen: 'F',
  volumeUp: 'ArrowUp',
  volumeDown: 'ArrowDown',
  toggleMute: 'M',
  togglePiP: 'P',
  showHelp: 'H',
  toggleControlsPin: 'Shift+H',
  cycleFit: 'Z',
  cycleLayout: 'Shift+L',
  toggleChat: 'Alt+R',
  toggleCaptions: 'C',
  increaseCaptionSize: '+',
  decreaseCaptionSize: '-',
  toggleVolumeBoost: 'Shift+B',
  cycleVoice: 'V',
  cycleLeveling: 'R',
  cycleBass: 'B',
  navigateUp: 'KeyW',
  navigateLeft: 'KeyA',
  navigateDown: 'KeyS',
  navigateRight: 'KeyD'
};

// Defaults added after release must not steal keys from existing custom actions.
const INTRODUCED_SHORTCUTS: Array<keyof Shortcuts> = ['cycleLayout', 'toggleChat', 'toggleVolumeBoost', 'cycleVoice', 'cycleLeveling', 'cycleBass', 'decreaseSpeed', 'increaseSpeed', ...NAVIGATION_SHORTCUTS];

export function withShortcutDefaults(saved: Record<string, unknown> | undefined): Shortcuts {
  const next = { ...defaultShortcuts };
  if (!saved) return next;
  (Object.keys(defaultShortcuts) as Array<keyof Shortcuts>).forEach((key) => {
    const value = saved[key];
    // An explicit empty value disables a shortcut; absent values still migrate to defaults.
    if (typeof value === 'string') next[key] = value;
  });
  for (const key of INTRODUCED_SHORTCUTS) {
    if (typeof saved[key] !== 'string' && shortcutConflicts(next, key, next[key]).length) next[key] = '';
  }
  return next;
}

const shiftedKeys = '<>?:"{}|_+~!@#$%^&*()';

// macOS Option changes key (Option+R is ®, Option+1 is ¡). Use the physical
// letter or digit for Alt bindings, while leaving ordinary typing and
// punctuation bindings unchanged.
function altLetter(event: KeyboardEvent): string | null {
  const physical = /^(?:Key[A-Z]|Digit[0-9])$/.test(event.code) ? event.code.replace(/^(?:Key|Digit)/, '') : null;
  return event.altKey ? physical : null;
}

// A Cyrillic, Greek or Hebrew layout prints a letter that no Latin shortcut can name. When `key` is such a letter
// the position (`KeyM`) is the only portable identity, so letter shortcuts fall back to it. A Latin `key` never does:
// on AZERTY, QWERTZ or Dvorak the printed letter decides, and punctuation printed on a letter position (Dvorak `,` at
// `KeyW`) keeps meaning that punctuation.
function nonLatinLetterPosition(event: KeyboardEvent): string | null {
  if (!/^Key[A-Z]$/.test(event.code) || [...event.key].length !== 1) return null;
  return /\p{L}/u.test(event.key) && !/\p{Script=Latin}/u.test(event.key) ? event.code.slice(3) : null;
}

/**
 * `physical` records a letter or digit by its position (`KeyW`), which `matchesShortcut` already accepts
 * through `event.code`, so a layout that prints another letter there still triggers it.
 */
// On a non-Latin layout a letter is recorded as the Latin letter of its position, not the printed one: the stored
// value then fires on every layout and conflicts with a Latin binding of the same key, where a Cyrillic `Ь` would
// neither match on QWERTY nor collide with `M`.
export function shortcutFromEvent(event: KeyboardEvent, physical = false): string {
  if (event.isComposing || ['Control', 'Alt', 'AltGraph', 'Shift', 'Meta', 'Dead', 'Unidentified', 'Process'].includes(event.key)) return '';
  const key = (physical && /^(?:Key[A-Z]|Digit\d)$/.test(event.code) ? event.code : null) ?? nonLatinLetterPosition(event) ?? altLetter(event) ?? (event.key === ' ' || event.key === 'Spacebar' ? 'Space'
    : event.key.length === 1 ? event.key.toUpperCase() : event.key);
  return [event.ctrlKey ? 'Ctrl' : '', event.altKey ? 'Alt' : '',
    event.shiftKey && !shiftedKeys.includes(key) ? 'Shift' : '', event.metaKey ? 'Meta' : '', key]
    .filter(Boolean).join('+');
}

function mainKey(shortcut: string): string {
  return shortcut.split('+').pop() || '+';
}

/** Compare the events accepted by the runtime, including physical codes and implicit Shift. */
export function shortcutsConflict(left: string, right: string): boolean {
  if (!left || !right) return false;
  const candidates = new Set([mainKey(left), mainKey(right)]);
  for (const value of [...candidates]) {
    if (/^Key[A-Z]$/i.test(value)) candidates.add(value.slice(3));
    if (/^Digit[0-9]$/i.test(value)) candidates.add(value.slice(5));
    if (['+', '=', 'Equal', 'NumpadAdd'].includes(value)) { candidates.add('+'); candidates.add('='); }
  }
  const codes: Record<string, string> = { Space: 'Space', Spacebar: 'Space', ' ': 'Space', '+': 'Equal', '=': 'Equal', '-': 'Minus', '_': 'Minus', '<': 'Comma', '>': 'Period', '?': 'Slash' };
  for (const key of candidates) {
    const code = /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}`
      : /^[0-9]$/.test(key) ? `Digit${key}` : codes[key] || key;
    for (let modifiers = 0; modifiers < 16; modifiers++) {
      const event = { key, code, ctrlKey: Boolean(modifiers & 1), altKey: Boolean(modifiers & 2),
        shiftKey: Boolean(modifiers & 4), metaKey: Boolean(modifiers & 8) } as KeyboardEvent;
      if (matchesShortcut(event, left) && matchesShortcut(event, right)) return true;
    }
  }
  return false;
}

export function shortcutConflicts(shortcuts: Shortcuts, action: keyof Shortcuts, shortcut: string): Array<keyof Shortcuts> {
  return (Object.keys(defaultShortcuts) as Array<keyof Shortcuts>)
    .filter(key => key !== action && shortcutsConflict(shortcut, shortcuts[key]));
}

export function assignShortcut(shortcuts: Shortcuts, action: keyof Shortcuts, shortcut: string): Shortcuts {
  const next = { ...shortcuts };
  for (const conflict of shortcutConflicts(shortcuts, action, shortcut)) next[conflict] = '';
  next[action] = shortcut;
  return next;
}

export function isReservedShortcut(action: keyof Shortcuts, shortcut: string): boolean {
  return action !== 'exit' && ['ESCAPE', 'ESC'].includes(mainKey(shortcut).toUpperCase());
}

const layoutNames = new Map<string, string>();

/** Learns what the current keyboard prints on each position; Chromium only, and never needed for matching. */
export async function loadKeyboardLayout(): Promise<void> {
  const keyboard = (navigator as Navigator & { keyboard?: { getLayoutMap?: () => Promise<ReadonlyMap<string, string>> } }).keyboard;
  try {
    const map = await keyboard?.getLayoutMap?.();
    layoutNames.clear();
    map?.forEach((value, code) => layoutNames.set(code, value));
  } catch {
    layoutNames.clear();
    // Not allowed in this context (for example a cross-origin frame): positions keep their default names.
  }
}

let platform: ShortcutPlatform | undefined;

/** This context's display environment: the platform, resolved once, and the layout learned so far. */
export function shortcutDisplayEnv(): ShortcutDisplayEnv {
  platform ??= detectShortcutPlatform(navigator as Navigator & { userAgentData?: { platform?: string } });
  return { platform, layout: layoutNames };
}

export function matchesShortcut(e: KeyboardEvent, shortcutStr: string): boolean {
  // Pages dispatch synthetic key events (plain `Event`s, autofill) that lack `key`/`code`.
  if (!shortcutStr || typeof e.key !== 'string' || typeof e.code !== 'string') return false;

  const parts = shortcutStr.split('+');
  const mainKey = parts.pop() || '+';

  let eventKey = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  if (eventKey === ' ' || eventKey === 'SPACEBAR') {
    eventKey = 'SPACE';
  } else {
    eventKey = eventKey.toUpperCase();
  }

  const targetKey = mainKey.toUpperCase();
  const isCompatiblePlus = targetKey === '+' && (
    eventKey === '+'
    || eventKey === '='
    || e.code === 'NumpadAdd'
    || e.code === 'Equal'
  );
  if (!isCompatiblePlus && eventKey !== targetKey && e.code.toUpperCase() !== targetKey
      && altLetter(e) !== targetKey && nonLatinLetterPosition(e) !== targetKey) return false;

  const hasCtrl = parts.includes('Ctrl');
  const hasAlt = parts.includes('Alt');
  const hasShift = parts.includes('Shift');
  const hasMeta = parts.includes('Meta');

  if (e.ctrlKey !== hasCtrl) return false;
  if (e.altKey !== hasAlt) return false;
  if (e.metaKey !== hasMeta) return false;

  const isShiftedChar = ['<', '>', '?', ':', '"', '{', '}', '|', '_', '+', '~', '!', '@', '#', '$', '%', '^', '&', '*', '(', ')'].includes(mainKey);
  if (!isShiftedChar && e.shiftKey !== hasShift) return false;

  return true;
}
