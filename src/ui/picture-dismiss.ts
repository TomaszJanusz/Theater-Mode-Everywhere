/**
 * A picture click that dismisses open chrome must not also toggle playback.
 * Hover panels close on pointerleave, and the window capture listener closes
 * pinned menus, both before the picture's click handler can see them.
 *
 * The decision is made once per press, on pointerdown, and consumed by the
 * click it belongs to. A pointer leaving a popover only leaves a short-lived
 * hint, so a panel that closed long ago never swallows a later click.
 */
export const LEAVE_HINT_MS = 1000;

export interface PictureDismissLatch {
  /** The pointer left a popover for somewhere outside the control bar. */
  noteLeave(): void;
  /** Primary press on the picture; `chromeOpen` is whether any panel was open. */
  press(chromeOpen: boolean): void;
  /** True once, for the click that should only dismiss chrome. */
  consume(): boolean;
  clear(): void;
}

export function createPictureDismissLatch(now: () => number = () => performance.now()): PictureDismissLatch {
  let leftAt: number | null = null;
  let dismiss = false;
  return {
    noteLeave() {
      leftAt = now();
    },
    press(chromeOpen) {
      dismiss = chromeOpen || (leftAt != null && now() - leftAt <= LEAVE_HINT_MS);
      leftAt = null;
    },
    consume() {
      const result = dismiss;
      dismiss = false;
      return result;
    },
    clear() {
      leftAt = null;
      dismiss = false;
    }
  };
}

const latch = createPictureDismissLatch();

/** Note a leave when the pointer exits a popover. Moving inside the bar does not count. */
export function armPictureDismissOnLeave(event: Event, popover: Element): void {
  const next = 'relatedTarget' in event ? (event as MouseEvent).relatedTarget : null;
  const controls = popover.closest('.theater-controls-wrapper');
  if (next instanceof Node && controls?.contains(next)) return;
  latch.noteLeave();
}

export const beginPicturePress = (chromeOpen: boolean): void => latch.press(chromeOpen);
export const clearPictureDismiss = (): void => latch.clear();
export const consumePictureDismiss = (): boolean => latch.consume();

export function playerChromeExpanded(root: ParentNode | null | undefined): boolean {
  if (!root) return false;
  if (root.querySelector('.theater-menu.is-open, .theater-menu-panel.visible')) return true;
  for (const selector of ['.theater-volume-container', '.theater-speed-container']) {
    const host = root.querySelector(selector);
    if (host instanceof Element && host.matches(':hover, :focus-within')) return true;
  }
  return false;
}
