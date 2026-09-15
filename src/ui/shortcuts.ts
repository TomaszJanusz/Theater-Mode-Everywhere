export interface Shortcuts {
  toggle: string;
  exit: string;
  seekBack: string;
  seekForward: string;
  cycle: string;
  playPause: string;
  frameBack: string;
  frameForward: string;
  toggleFullscreen: string;
  volumeUp: string;
  volumeDown: string;
  togglePiP: string;
  showHelp: string;
  cycleFit: string;
  toggleCaptions: string;
}

export const defaultShortcuts: Shortcuts = {
  toggle: 'T',
  exit: 'Escape',
  seekBack: 'ArrowLeft',
  seekForward: 'ArrowRight',
  cycle: 'Shift+T',
  playPause: 'Space',
  frameBack: '<',
  frameForward: '>',
  toggleFullscreen: 'F',
  volumeUp: 'ArrowUp',
  volumeDown: 'ArrowDown',
  togglePiP: 'P',
  showHelp: 'H',
  cycleFit: 'Z',
  toggleCaptions: 'C'
};

export function withShortcutDefaults(saved: Record<string, unknown> | undefined): Shortcuts {
  const next = { ...defaultShortcuts };
  if (!saved) return next;
  (Object.keys(defaultShortcuts) as Array<keyof Shortcuts>).forEach((key) => {
    const value = saved[key];
    if (typeof value === 'string' && value) next[key] = value;
  });
  return next;
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
  if (eventKey !== targetKey && e.code.toUpperCase() !== targetKey) return false;

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
