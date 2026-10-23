/**
 * How a stored shortcut (`Ctrl+Shift+K`, `ArrowLeft`, `KeyW`) is shown to people and assistive technology.
 * Visible text is the legend printed on a keycap and is never translated; only the spoken names of glyph
 * caps (arrows, macOS modifiers, plus) and abbreviated legends are localized. Pure: the platform, keyboard
 * layout and message lookup arrive in `env`, so storage and matching (`shortcuts.ts`) stay unaware of it.
 */

export type ShortcutPlatform = 'mac' | 'windows' | 'other';
export type ShortcutModifier = 'Ctrl' | 'Alt' | 'Shift' | 'Meta';

export interface KeyToken {
  /** What the cap shows. */
  text: string;
  /** What a screen reader should say for the cap; equals `text` when the legend reads well. */
  label: string;
  kind: 'modifier' | 'key';
}

export interface ShortcutDisplayEnv {
  platform: ShortcutPlatform;
  /** `KeyboardLayoutMap` contents: what the current layout prints on each physical position. */
  layout?: ReadonlyMap<string, string>;
  /** Localized spoken name for a `KEY_LABEL_FALLBACKS` message, or undefined to use the English one. */
  spoken?: (message: KeyLabelMessage) => string | undefined;
}

/** English spoken names; the localized ones live in `_locales/` under the same keys. */
export const KEY_LABEL_FALLBACKS = {
  keyLabelArrowUp: 'Up arrow',
  keyLabelArrowDown: 'Down arrow',
  keyLabelArrowLeft: 'Left arrow',
  keyLabelArrowRight: 'Right arrow',
  keyLabelPlus: 'Plus',
  keyLabelControl: 'Control',
  keyLabelOption: 'Option',
  keyLabelShift: 'Shift',
  keyLabelCommand: 'Command',
  keyLabelWindows: 'Windows',
  keyLabelEscape: 'Escape',
  keyLabelDelete: 'Delete',
  keyLabelInsert: 'Insert'
} as const satisfies Record<string, string>;
export type KeyLabelMessage = keyof typeof KEY_LABEL_FALLBACKS;

const MODIFIERS: readonly ShortcutModifier[] = ['Ctrl', 'Alt', 'Shift', 'Meta'];

type Legend = { text: string; label?: KeyLabelMessage };

const MODIFIER_LEGENDS: Record<ShortcutPlatform, Record<ShortcutModifier, Legend>> = {
  // Apple prints glyphs and orders them Control, Option, Shift, Command, the stored order.
  mac: {
    Ctrl: { text: '⌃', label: 'keyLabelControl' },
    Alt: { text: '⌥', label: 'keyLabelOption' },
    Shift: { text: '⇧', label: 'keyLabelShift' },
    Meta: { text: '⌘', label: 'keyLabelCommand' }
  },
  windows: { Ctrl: { text: 'Ctrl' }, Alt: { text: 'Alt' }, Shift: { text: 'Shift' }, Meta: { text: 'Win', label: 'keyLabelWindows' } },
  other: { Ctrl: { text: 'Ctrl' }, Alt: { text: 'Alt' }, Shift: { text: 'Shift' }, Meta: { text: 'Super' } }
};

const KEY_LEGENDS: Record<string, Legend> = {
  ArrowUp: { text: '↑', label: 'keyLabelArrowUp' },
  ArrowDown: { text: '↓', label: 'keyLabelArrowDown' },
  ArrowLeft: { text: '←', label: 'keyLabelArrowLeft' },
  ArrowRight: { text: '→', label: 'keyLabelArrowRight' },
  '+': { text: '+', label: 'keyLabelPlus' },
  Escape: { text: 'Esc', label: 'keyLabelEscape' },
  Esc: { text: 'Esc', label: 'keyLabelEscape' },
  Delete: { text: 'Del', label: 'keyLabelDelete' },
  Insert: { text: 'Ins', label: 'keyLabelInsert' },
  PageUp: { text: 'Page Up' },
  PageDown: { text: 'Page Down' }
};

/** Splits a stored shortcut; the main key is last, so `Ctrl++` is Ctrl with the plus key. */
export function parseShortcut(stored: string): { modifiers: ShortcutModifier[]; key: string } {
  if (!stored) return { modifiers: [], key: '' };
  const parts = stored.split('+');
  const key = parts.pop() || '+';
  const named = new Set(parts);
  return { modifiers: MODIFIERS.filter(modifier => named.has(modifier)), key };
}

/** What a key prints: the layout's legend for a position, the QWERTY one without a layout map. */
function keyLegend(key: string, env: ShortcutDisplayEnv): Legend {
  if (/^(?:Key[A-Z]|Digit\d)$/.test(key)) return { text: upperChar(env.layout?.get(key) || key.replace(/^(?:Key|Digit)/, '')) };
  const numpadDigit = /^Numpad(\d)$/.exec(key);
  if (numpadDigit) return { text: `Num ${numpadDigit[1]}` };
  return KEY_LEGENDS[key] ?? { text: upperChar(key) };
}

/** Letters are shown as capitals, as on the cap; anything longer is a key name and keeps its case. */
function upperChar(text: string): string {
  if ([...text].length !== 1) return text;
  const upper = text.toUpperCase();
  return [...upper].length === 1 ? upper : text;
}

function token({ text, label }: Legend, kind: KeyToken['kind'], env: ShortcutDisplayEnv): KeyToken {
  return { text, label: label ? env.spoken?.(label) ?? KEY_LABEL_FALLBACKS[label] : text, kind };
}

/** One token per cap, modifiers first; empty when the shortcut is unassigned. */
export function shortcutTokens(stored: string, env: ShortcutDisplayEnv): KeyToken[] {
  if (!stored) return [];
  const { modifiers, key } = parseShortcut(stored);
  return [
    ...modifiers.map(modifier => token(MODIFIER_LEGENDS[env.platform][modifier], 'modifier', env)),
    token(keyLegend(key, env), 'key', env)
  ];
}

/** Caps in a row are joined by `+`, except on macOS where glyphs sit side by side. */
export function shortcutSeparator(platform: ShortcutPlatform): string {
  return platform === 'mac' ? '' : '+';
}

/** Plain text for `title`, dialogs and inputs: `Ctrl+Shift+K`, or `⌃⇧K` on macOS. */
export function shortcutLabel(stored: string, env: ShortcutDisplayEnv): string {
  return shortcutTokens(stored, env).map(({ text }) => text).join(shortcutSeparator(env.platform));
}

/** Resolves once per context: `userAgentData` where available, `navigator.platform` otherwise. */
export function detectShortcutPlatform(nav: { platform?: string; userAgentData?: { platform?: string } }): ShortcutPlatform {
  const platform = nav.userAgentData?.platform || nav.platform || '';
  if (/mac|iphone|ipad|ipod/i.test(platform)) return 'mac';
  if (/^win/i.test(platform)) return 'windows';
  return 'other';
}
