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

/** Always-visible controls hold the playback bar; keyboard focus holds all player chrome. */
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

export const CONTROLS_VISIBILITY_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 15h18"/><path d="M7 17.5h4m5 0h1"/></svg>`;
