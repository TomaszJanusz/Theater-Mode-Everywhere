/**
 * A picture click that dismisses open chrome must not also toggle playback.
 * Hover panels close on pointerleave, and the window capture listener closes
 * pinned menus, both before the picture's click handler can see them.
 */
let armed = false;

export function armPictureDismiss(): void {
  armed = true;
}

/** Arm when the pointer leaves a popover for the picture. Moving inside the bar does not. */
export function armPictureDismissOnLeave(event: Event, popover: Element): void {
  const next = 'relatedTarget' in event ? (event as MouseEvent).relatedTarget : null;
  const controls = popover.closest('.theater-controls-wrapper');
  if (next instanceof Node && controls?.contains(next)) return;
  armPictureDismiss();
}

export function clearPictureDismiss(): void {
  armed = false;
}

/** True once, for the picture click that should only dismiss chrome. */
export function consumePictureDismiss(): boolean {
  const dismiss = armed;
  armed = false;
  return dismiss;
}

export function playerChromeExpanded(root: ParentNode | null | undefined): boolean {
  if (!root) return false;
  if (root.querySelector('.theater-menu.is-open, .theater-menu-panel.visible')) return true;
  for (const selector of ['.theater-volume-container', '.theater-speed-container']) {
    const host = root.querySelector(selector);
    if (host instanceof Element && host.matches(':hover, :focus-within')) return true;
  }
  return false;
}
