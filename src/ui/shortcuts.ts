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
}

export const defaultShortcuts: Shortcuts = {
  toggle: 'T',
  exit: 'Escape',
  seekBack: 'ArrowLeft',
  seekForward: 'ArrowRight',
  cycle: 'Shift+T',
  playPause: 'Space',
  previousVideo: 'Shift+P',
  nextVideo: 'Shift+N',
  frameBack: '<',
  frameForward: '>',
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
  decreaseCaptionSize: '-'
};

export function withShortcutDefaults(saved: Record<string, unknown> | undefined): Shortcuts {
  const next = { ...defaultShortcuts };
  if (!saved) return next;
  (Object.keys(defaultShortcuts) as Array<keyof Shortcuts>).forEach((key) => {
    const value = saved[key];
    // An explicit empty value disables a shortcut; absent values still migrate to defaults.
    if (typeof value === 'string') next[key] = value;
  });
  // Introducing Layout must not steal Shift+L from an existing custom action.
  if (typeof saved.cycleLayout !== 'string' && shortcutConflicts(next, 'cycleLayout', next.cycleLayout).length) {
    next.cycleLayout = '';
  }
  if (typeof saved.toggleChat !== 'string' && shortcutConflicts(next, 'toggleChat', next.toggleChat).length) {
    next.toggleChat = '';
  }
  return next;
}

const shiftedKeys = '<>?:"{}|_+~!@#$%^&*()';

// macOS Option changes key (Option+R is ®). Use the physical letter for Alt
// bindings, while leaving ordinary typing and punctuation bindings unchanged.
function altLetter(event: KeyboardEvent): string | null {
  return event.altKey && /^Key[A-Z]$/.test(event.code) ? event.code.slice(3) : null;
}

export function shortcutFromEvent(event: KeyboardEvent): string {
  if (event.isComposing || ['Control', 'Alt', 'AltGraph', 'Shift', 'Meta', 'Dead', 'Unidentified', 'Process'].includes(event.key)) return '';
  const key = altLetter(event) ?? (event.key === ' ' || event.key === 'Spacebar' ? 'Space'
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

export function shortcutDisplayParts(shortcutStr: string): string[] {
  if (!shortcutStr) return [];
  const parts = shortcutStr.split('+');
  const mainKey = parts.pop() || '+';
  return [...parts.filter(Boolean), mainKey];
}

export function matchesShortcut(e: KeyboardEvent, shortcutStr: string): boolean {
  if (!shortcutStr) return false;

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
      && altLetter(e) !== targetKey) return false;

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
