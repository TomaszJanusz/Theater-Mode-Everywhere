/**
 * Separates a picture click (play/pause) from a double-click (fullscreen).
 * A click waits out the double-click window so the pair never pauses and
 * resumes visibly; a double-click cancels the pending click instead.
 */
export const PICTURE_DOUBLE_CLICK_MS = 280;

export interface PictureClickGate {
  click(): void;
  doubleClick(): void;
  /** Drop a pending click. Safe to repeat. */
  cancel(): void;
}

export function createPictureClickGate(
  onClick: () => void,
  onDoubleClick: () => void,
  timers: {
    set: (fn: () => void, ms: number) => unknown;
    clear: (id: unknown) => void;
  } = {
    set: (fn, ms) => window.setTimeout(fn, ms),
    clear: id => window.clearTimeout(id as number)
  }
): PictureClickGate {
  let pending: unknown = null;
  const cancel = () => {
    if (pending == null) return;
    timers.clear(pending);
    pending = null;
  };
  return {
    click() {
      cancel();
      pending = timers.set(() => {
        pending = null;
        onClick();
      }, PICTURE_DOUBLE_CLICK_MS);
    },
    doubleClick() {
      cancel();
      onDoubleClick();
    },
    cancel
  };
}
