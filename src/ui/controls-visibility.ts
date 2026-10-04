export const KEEP_CONTROLS_VISIBLE_STORAGE_KEY = 'keepControlsVisible';

export function resolveKeepControlsVisible(value: unknown): boolean {
  return value === true;
}

export type ChromeActivity = {
  active: boolean;
  pinned: boolean;
  controlsHovered: boolean;
  scrubberDragging: boolean;
  keyboardFocused: boolean;
  headerActive: boolean;
  helpOpen: boolean;
};

/** The pin holds the playback bar; keyboard focus still holds all player chrome. */
export function resolveChromeVisibility(activity: ChromeActivity) {
  const interaction = activity.controlsHovered || activity.scrubberDragging;
  const accessibleChrome = activity.keyboardFocused || activity.headerActive || activity.helpOpen;
  const headerVisible = activity.active || accessibleChrome || (!activity.pinned && interaction);
  return {
    controlsVisible: activity.pinned || headerVisible || interaction,
    headerVisible,
    cursorVisible: headerVisible || interaction
  };
}

export const CONTROLS_PIN_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 3 21 8l-4 1-3 5 1 3-2 2-8-8 2-2 3 1 5-3Z"/><path d="m9 15-6 6"/></svg>`;
